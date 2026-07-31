import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { KnowledgeSearchInputSchema } from "../contracts/commerce.schemas.server";
import { z } from "zod";

const KnowledgeSourceInputSchema = z.object({
  type: z.enum(["SHOPIFY_CATALOG", "STORE_POLICIES", "FAQ", "GUIDE", "DOCUMENT", "MANUAL"]),
  name: z.string().trim().min(1).max(255),
  status: z.enum(["ACTIVE", "INACTIVE", "PROCESSING", "ERROR", "ARCHIVED"]).optional(),
  sourceUrl: z.string().url().max(2048).nullable().optional(),
  externalId: z.string().trim().max(512).nullable().optional(),
  lastSyncedAt: z.coerce.date().nullable().optional()
}).strict();

const KnowledgeSourceUpdateSchema = KnowledgeSourceInputSchema.partial();

const KnowledgeDocumentInputSchema = z.object({
  sourceId: z.string().trim().min(1).max(255),
  title: z.string().trim().min(1).max(500),
  content: z.string().min(1).max(1_000_000),
  status: z.enum(["ACTIVE", "INACTIVE", "PROCESSING", "ERROR", "ARCHIVED"]).optional(),
  checksum: z.string().trim().max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  publishedAt: z.coerce.date().nullable().optional()
}).strict();

export class PostgresFullTextRetriever {
  async search(context, input) {
    const parsed = KnowledgeSearchInputSchema.parse(input);
    const rows = await prisma.$queryRaw(Prisma.sql`
      SELECT
        chunk."id",
        chunk."documentId",
        document."title",
        chunk."content",
        ts_rank(chunk."searchVector", websearch_to_tsquery('simple', ${parsed.query})) AS "score"
      FROM "KnowledgeChunk" AS chunk
      INNER JOIN "KnowledgeDocument" AS document ON document."id" = chunk."documentId"
      INNER JOIN "KnowledgeSource" AS source ON source."id" = document."sourceId"
      WHERE chunk."shopId" = ${context.shopId}
        AND document."shopId" = ${context.shopId}
        AND source."shopId" = ${context.shopId}
        AND document."status" = 'ACTIVE'::"KnowledgeStatus"
        AND source."status" = 'ACTIVE'::"KnowledgeStatus"
        AND chunk."searchVector" @@ websearch_to_tsquery('simple', ${parsed.query})
      ORDER BY "score" DESC, chunk."position" ASC
      LIMIT ${parsed.limit}
    `);

    let consumed = 0;
    const results = [];
    for (const row of rows) {
      const remaining = parsed.maxCharacters - consumed;
      if (remaining <= 0) break;
      const content = row.content.slice(0, remaining);
      if (!content) break;
      results.push({
        content,
        score: Number(row.score),
        reference: {
          documentId: row.documentId,
          chunkId: row.id,
          title: row.title
        }
      });
      consumed += content.length;
    }
    return results;
  }
}

export class PgVectorRetriever {
  async search() {
    throw new Error("PgVector retrieval is not enabled");
  }
}

export class HybridRetriever {
  async search() {
    throw new Error("Hybrid retrieval is not enabled");
  }
}

export function createKnowledgeService({ retriever = new PostgresFullTextRetriever() } = {}) {
  return {
    createKnowledgeSource: (context, input) => {
      assertContext(context);
      const parsed = KnowledgeSourceInputSchema.parse(input);
      return prisma.knowledgeSource.create({
        data: { ...parsed, shopId: context.shopId }
      });
    },

    updateKnowledgeSource: (context, sourceId, input) => {
      assertContext(context);
      return prisma.knowledgeSource.updateMany({
        where: { id: sourceId, shopId: context.shopId },
        data: KnowledgeSourceUpdateSchema.parse(input)
      });
    },

    upsertKnowledgeDocument: async (context, input) => {
      assertContext(context);
      const parsed = KnowledgeDocumentInputSchema.parse(input);
      const source = await prisma.knowledgeSource.findFirst({
        where: { id: parsed.sourceId, shopId: context.shopId },
        select: { id: true }
      });
      if (!source) throw new Error("Knowledge source not found");

      const checksum = parsed.checksum || createHash("sha256").update(parsed.content).digest("hex");
      return prisma.knowledgeDocument.upsert({
        where: {
          shopId_sourceId_checksum: {
            shopId: context.shopId,
            sourceId: parsed.sourceId,
            checksum
          }
        },
        create: { ...parsed, shopId: context.shopId, checksum },
        update: {
          title: parsed.title,
          content: parsed.content,
          metadata: parsed.metadata,
          status: parsed.status || "ACTIVE",
          publishedAt: parsed.publishedAt,
          version: { increment: 1 }
        }
      });
    },

    chunkKnowledgeDocument: async (context, documentId, content, { maxCharacters = 1400 } = {}) => {
      assertContext(context);
      const document = await prisma.knowledgeDocument.findFirst({
        where: { id: documentId, shopId: context.shopId },
        select: { id: true }
      });
      if (!document) throw new Error("Knowledge document not found");
      const chunks = chunkText(content, maxCharacters);
      await prisma.$transaction([
        prisma.knowledgeChunk.deleteMany({ where: { documentId, shopId: context.shopId } }),
        prisma.knowledgeChunk.createMany({
          data: chunks.map((chunk, position) => ({
            shopId: context.shopId,
            documentId,
            position,
            content: chunk
          }))
        })
      ]);
      return chunks.length;
    },

    searchKnowledge: (context, input) => {
      assertContext(context);
      return retriever.search(context, input);
    },

    deleteKnowledgeSource: (context, sourceId) => {
      assertContext(context);
      return prisma.knowledgeSource.deleteMany({
        where: { id: sourceId, shopId: context.shopId }
      });
    }
  };
}

export function chunkText(content, maxCharacters = 1400) {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 200 || maxCharacters > 12000) {
    throw new Error("Invalid knowledge chunk size");
  }
  const paragraphs = String(content || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxCharacters) {
      if (current) chunks.push(current);
      current = "";
      for (let index = 0; index < paragraph.length; index += maxCharacters) {
        chunks.push(paragraph.slice(index, index + maxCharacters));
      }
    } else if (!current) {
      current = paragraph;
    } else if (current.length + paragraph.length + 2 <= maxCharacters) {
      current += `\n\n${paragraph}`;
    } else {
      chunks.push(current);
      current = paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function assertContext(context) {
  if (!context?.shopId) throw new Error("Merchant context is required");
}
