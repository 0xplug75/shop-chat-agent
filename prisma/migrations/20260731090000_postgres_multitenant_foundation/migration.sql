-- This migration is the PostgreSQL foundation for IntentCart. It is intended
-- for a fresh PostgreSQL/Supabase database. Existing SQLite development data
-- must be exported and mapped to canonical Shop records before import.

CREATE TYPE "ShopStatus" AS ENUM ('ACTIVE', 'UNINSTALLED', 'SUSPENDED');
CREATE TYPE "KnowledgeSourceType" AS ENUM ('SHOPIFY_CATALOG', 'STORE_POLICIES', 'FAQ', 'GUIDE', 'DOCUMENT', 'MANUAL');
CREATE TYPE "KnowledgeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PROCESSING', 'ERROR', 'ARCHIVED');
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED', 'EXPIRED');
CREATE TYPE "ConversationChannel" AS ENUM ('STOREFRONT_WIDGET', 'ADMIN_PREVIEW', 'AGENT_EXTERNAL');
CREATE TYPE "JourneyStage" AS ENUM ('DISCOVER', 'COMPARE', 'CONFIRM', 'CART', 'CHECKOUT', 'COMPLETED', 'ABANDONED', 'EXPIRED');

CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyShopId" TEXT,
    "storefrontOrigin" TEXT,
    "status" "ShopStatus" NOT NULL DEFAULT 'ACTIVE',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MerchantConfig" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "assistantName" TEXT NOT NULL,
    "personality" TEXT NOT NULL,
    "brandVoice" TEXT NOT NULL,
    "welcomeMessage" TEXT NOT NULL,
    "quickPrompts" JSONB NOT NULL,
    "commerceRules" JSONB NOT NULL,
    "recommendationRules" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MerchantConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" "KnowledgeSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceUrl" TEXT,
    "externalId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "checksum" TEXT NOT NULL,
    "metadata" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "searchVector" TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content", ''))) STORED,
    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Conversation"
    ADD COLUMN "customerId" TEXT,
    ADD COLUMN "visitorId" TEXT,
    ADD COLUMN "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "channel" "ConversationChannel" NOT NULL DEFAULT 'STOREFRONT_WIDGET',
    ADD COLUMN "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "endedAt" TIMESTAMP(3),
    ALTER COLUMN "shopId" SET NOT NULL;

ALTER TABLE "Message"
    ADD COLUMN "shopId" TEXT NOT NULL,
    ADD COLUMN "structuredContent" JSONB,
    ADD COLUMN "toolCalls" JSONB,
    ADD COLUMN "toolResults" JSONB,
    ADD COLUMN "model" TEXT,
    ADD COLUMN "inputTokens" INTEGER,
    ADD COLUMN "outputTokens" INTEGER,
    ADD COLUMN "latencyMs" INTEGER;

CREATE TABLE "CommerceSession" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "visitorId" TEXT,
    "customerId" TEXT,
    "journeyStage" "JourneyStage" NOT NULL DEFAULT 'DISCOVER',
    "structuredIntent" JSONB,
    "constraints" JSONB NOT NULL,
    "recommendedProducts" JSONB NOT NULL,
    "comparedProducts" JSONB NOT NULL,
    "selectedProductId" TEXT,
    "selectedVariantId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "cartId" TEXT,
    "checkoutUrl" TEXT,
    "buyerContext" JSONB NOT NULL,
    "pendingMessages" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommerceSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "conversationId" TEXT,
    "commerceSessionId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "requestId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommerceEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "shopId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CustomerToken" RENAME COLUMN "accessToken" TO "encryptedAccessToken";
ALTER TABLE "CustomerToken" RENAME COLUMN "refreshToken" TO "encryptedRefreshToken";
ALTER TABLE "CustomerToken"
    ADD COLUMN "shopId" TEXT NOT NULL,
    ADD COLUMN "customerReference" TEXT NOT NULL,
    ALTER COLUMN "conversationId" DROP NOT NULL;

ALTER TABLE "CodeVerifier" RENAME TO "OAuthState";
ALTER TABLE "OAuthState" RENAME COLUMN "state" TO "stateHash";
ALTER TABLE "OAuthState" RENAME COLUMN "verifier" TO "encryptedCodeVerifier";
ALTER TABLE "OAuthState"
    ADD COLUMN "shopId" TEXT NOT NULL,
    ADD COLUMN "conversationId" TEXT,
    ADD COLUMN "redirectUri" TEXT,
    ADD COLUMN "consumedAt" TIMESTAMP(3);

DROP INDEX "CodeVerifier_state_key";
DROP INDEX "CodeVerifier_state_idx";

ALTER TABLE "CustomerAccountUrls"
    ADD COLUMN "shopId" TEXT NOT NULL;

CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");
CREATE UNIQUE INDEX "Shop_shopifyShopId_key" ON "Shop"("shopifyShopId");
CREATE INDEX "Shop_status_idx" ON "Shop"("status");
CREATE UNIQUE INDEX "MerchantConfig_shopId_key" ON "MerchantConfig"("shopId");
CREATE UNIQUE INDEX "KnowledgeSource_shopId_type_externalId_key" ON "KnowledgeSource"("shopId", "type", "externalId");
CREATE INDEX "KnowledgeSource_shopId_status_idx" ON "KnowledgeSource"("shopId", "status");
CREATE UNIQUE INDEX "KnowledgeDocument_shopId_sourceId_checksum_key" ON "KnowledgeDocument"("shopId", "sourceId", "checksum");
CREATE INDEX "KnowledgeDocument_shopId_status_idx" ON "KnowledgeDocument"("shopId", "status");
CREATE INDEX "KnowledgeDocument_sourceId_idx" ON "KnowledgeDocument"("sourceId");
CREATE UNIQUE INDEX "KnowledgeChunk_documentId_position_key" ON "KnowledgeChunk"("documentId", "position");
CREATE INDEX "KnowledgeChunk_shopId_documentId_idx" ON "KnowledgeChunk"("shopId", "documentId");
CREATE INDEX "KnowledgeChunk_searchVector_idx" ON "KnowledgeChunk" USING GIN ("searchVector");
DROP INDEX "Conversation_shopId_idx";
CREATE INDEX "Conversation_shopId_status_updatedAt_idx" ON "Conversation"("shopId", "status", "updatedAt");
CREATE INDEX "Conversation_shopId_visitorId_idx" ON "Conversation"("shopId", "visitorId");
DROP INDEX "Message_conversationId_idx";
CREATE INDEX "Message_shopId_conversationId_createdAt_idx" ON "Message"("shopId", "conversationId", "createdAt");
CREATE UNIQUE INDEX "CommerceSession_conversationId_key" ON "CommerceSession"("conversationId");
CREATE INDEX "CommerceSession_shopId_journeyStage_updatedAt_idx" ON "CommerceSession"("shopId", "journeyStage", "updatedAt");
CREATE INDEX "CommerceSession_shopId_expiresAt_idx" ON "CommerceSession"("shopId", "expiresAt");
CREATE INDEX "CommerceSession_shopId_cartId_idx" ON "CommerceSession"("shopId", "cartId");
CREATE INDEX "CommerceEvent_shopId_eventType_occurredAt_idx" ON "CommerceEvent"("shopId", "eventType", "occurredAt");
CREATE INDEX "CommerceEvent_conversationId_occurredAt_idx" ON "CommerceEvent"("conversationId", "occurredAt");
CREATE INDEX "CommerceEvent_commerceSessionId_occurredAt_idx" ON "CommerceEvent"("commerceSessionId", "occurredAt");
CREATE UNIQUE INDEX "WebhookReceipt_webhookId_key" ON "WebhookReceipt"("webhookId");
CREATE INDEX "WebhookReceipt_shopDomain_topic_processedAt_idx" ON "WebhookReceipt"("shopDomain", "topic", "processedAt");
CREATE INDEX "WebhookReceipt_shopId_idx" ON "WebhookReceipt"("shopId");
DROP INDEX "CustomerToken_conversationId_idx";
CREATE UNIQUE INDEX "CustomerToken_shopId_customerReference_key" ON "CustomerToken"("shopId", "customerReference");
CREATE INDEX "CustomerToken_shopId_conversationId_idx" ON "CustomerToken"("shopId", "conversationId");
CREATE INDEX "CustomerToken_shopId_expiresAt_idx" ON "CustomerToken"("shopId", "expiresAt");
CREATE UNIQUE INDEX "OAuthState_stateHash_key" ON "OAuthState"("stateHash");
CREATE INDEX "OAuthState_shopId_expiresAt_idx" ON "OAuthState"("shopId", "expiresAt");
CREATE INDEX "OAuthState_conversationId_idx" ON "OAuthState"("conversationId");
CREATE INDEX "CustomerAccountUrls_shopId_idx" ON "CustomerAccountUrls"("shopId");

ALTER TABLE "MerchantConfig" ADD CONSTRAINT "MerchantConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceSession" ADD CONSTRAINT "CommerceSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceSession" ADD CONSTRAINT "CommerceSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceEvent" ADD CONSTRAINT "CommerceEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceEvent" ADD CONSTRAINT "CommerceEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommerceEvent" ADD CONSTRAINT "CommerceEvent_commerceSessionId_fkey" FOREIGN KEY ("commerceSessionId") REFERENCES "CommerceSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WebhookReceipt" ADD CONSTRAINT "WebhookReceipt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerToken" ADD CONSTRAINT "CustomerToken_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerToken" ADD CONSTRAINT "CustomerToken_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerAccountUrls" ADD CONSTRAINT "CustomerAccountUrls_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerAccountUrls" ADD CONSTRAINT "CustomerAccountUrls_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS remains a defense-in-depth deployment step. Application services still
-- enforce shopId on every query; policies are documented in the deployment runbook.
