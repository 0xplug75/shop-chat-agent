import { createHash } from "node:crypto";
import prisma from "../db.server";
import { ExperimentAssignmentSchema } from "../contracts/commerce.schemas.server";
import { buildCommerceEventData } from "./analytics-event.server";

export const LAUNCHER_ENTRY_EXPERIMENT = "launcher_entry_v1";

export async function getOrCreateExperimentAssignment(
  context,
  { visitorId, experimentKey, enabled, killSwitch, treatmentPercentage },
) {
  if (!visitorId || !enabled || killSwitch) return null;
  const variant = assignVariant({
    shopId: context.shopId,
    visitorId,
    experimentKey,
    treatmentPercentage,
  });
  const record = await prisma.experimentAssignment.upsert({
    where: {
      shopId_visitorId_experimentKey: {
        shopId: context.shopId,
        visitorId,
        experimentKey,
      },
    },
    create: {
      shopId: context.shopId,
      visitorId,
      experimentKey,
      variant,
    },
    update: {},
  });
  return toContract(record);
}

export async function getExperimentAssignment(
  context,
  { visitorId, experimentKey },
) {
  if (!visitorId || !experimentKey) return null;
  const record = await prisma.experimentAssignment.findUnique({
    where: {
      shopId_visitorId_experimentKey: {
        shopId: context.shopId,
        visitorId,
        experimentKey,
      },
    },
  });
  return record ? toContract(record) : null;
}

export async function markExperimentExposed(
  context,
  assignmentId,
  at = new Date(),
) {
  const result = await prisma.experimentAssignment.updateMany({
    where: {
      id: assignmentId,
      shopId: context.shopId,
      exposedAt: null,
    },
    data: { exposedAt: at },
  });
  return result.count === 1;
}

export async function recordExperimentExposure(
  context,
  assignment,
  { conversationId = null, commerceSessionId = null, at = new Date() } = {},
) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.experimentAssignment.updateMany({
      where: {
        id: assignment.id,
        shopId: context.shopId,
        exposedAt: null,
      },
      data: { exposedAt: at },
    });
    if (updated.count !== 1) return false;

    await tx.commerceEvent.create({
      data: buildCommerceEventData(
        {
          ...context,
          experimentKey: assignment.experimentKey,
          experimentVariant: assignment.variant,
        },
        {
          eventType: "experiment_exposed",
          conversationId,
          commerceSessionId,
          payload: {
            experimentKey: assignment.experimentKey,
            variant: assignment.variant,
          },
          occurredAt: at,
        },
      ),
    });
    return true;
  });
}

export function assignVariant({
  shopId,
  visitorId,
  experimentKey,
  treatmentPercentage,
}) {
  const threshold = Math.min(Math.max(Number(treatmentPercentage), 0), 100);
  const digest = createHash("sha256")
    .update(`${shopId}:${experimentKey}:${visitorId}`)
    .digest();
  const bucket = digest.readUInt32BE(0) % 100;
  return bucket < threshold ? "contextual" : "reactive";
}

function toContract(record) {
  return ExperimentAssignmentSchema.parse({
    version: "1.0",
    id: record.id,
    experimentKey: record.experimentKey,
    variant: record.variant,
    visitorId: record.visitorId,
    assignedAt: record.createdAt.toISOString(),
    exposedAt: record.exposedAt?.toISOString() || null,
  });
}
