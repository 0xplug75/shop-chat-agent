import { randomUUID } from "node:crypto";
import prisma from "../../db.server";
import { createArgumentDigest } from "./sage-protocol.server";

export const CONFIRMATION_STATES = Object.freeze({
  PENDING: "pending",
  DECLINED: "declined",
  EXPIRED: "expired",
  CONSUMED: "consumed",
});

const DEFAULT_CONFIRMATION_TTL_MS = 2 * 60 * 1000;

export class CommerceConfirmationError extends Error {
  constructor(code, message, { status = 409, details } = {}) {
    super(message);
    this.name = "CommerceConfirmationError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.publicMessage = "This commerce confirmation is no longer valid.";
  }
}

export function createCommerceConfirmationService({
  store = createPrismaCommerceConfirmationStore(),
  now = () => new Date(),
  ttlMs = DEFAULT_CONFIRMATION_TTL_MS,
} = {}) {
  return {
    async issue({
      context,
      session,
      handoff,
      permission,
      candidate,
      commerceSnapshotRef,
      cartRef,
      cartVersion,
    }) {
      assertContext(context, session);
      const issuedAt = now();
      const handoffExpiry = new Date(handoff.expiresAt);
      const expiresAt = new Date(
        Math.min(issuedAt.getTime() + ttlMs, handoffExpiry.getTime()),
      );
      const digestInput = compact({
        action: handoff.shopperActionIntent,
        candidate,
        commerceSnapshotRef,
        cartRef,
        cartVersion,
        stateRevision: handoff.stateRevision,
      });
      const receipt = compact({
        kind: "CommerceConfirmationReceipt",
        version: "1.0",
        confirmationId: `confirmation:${randomUUID()}`,
        handoffId: handoff.handoffId,
        permissionDecisionId: permission.permissionDecisionId,
        stateRevision: handoff.stateRevision,
        action: handoff.shopperActionIntent,
        candidate,
        commerceSnapshotRef,
        cartRef,
        cartVersion,
        argumentDigest: createArgumentDigest(digestInput),
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        singleUse: true,
      });
      const record = await store.issue({
        id: receipt.confirmationId,
        shopId: context.shopId,
        commerceSessionId: session.id,
        handoffId: handoff.handoffId,
        permissionDecisionId: permission.permissionDecisionId,
        stateRevision: handoff.stateRevision,
        action: handoff.shopperActionIntent,
        argumentDigest: receipt.argumentDigest,
        receipt,
        status: CONFIRMATION_STATES.PENDING,
        expiresAt,
      });
      if (record.argumentDigest !== receipt.argumentDigest) {
        throw new CommerceConfirmationError(
          "CONFIRMATION_ARGUMENT_CONFLICT",
          "Handoff was already confirmed with different arguments",
        );
      }
      return structuredClone(record.receipt);
    },

    async decide({ context, session, handoff, confirmationId, decision }) {
      assertContext(context, session);
      if (!confirmationId) {
        throw new CommerceConfirmationError(
          "CONFIRMATION_ID_REQUIRED",
          "Confirmation id is required",
          { status: 400 },
        );
      }
      if (!["accept", "decline"].includes(decision)) {
        throw new CommerceConfirmationError(
          "CONFIRMATION_DECISION_INVALID",
          "Confirmation decision must be accept or decline",
          { status: 400 },
        );
      }
      return store.decide({
        id: confirmationId,
        shopId: context.shopId,
        commerceSessionId: session.id,
        handoffId: handoff.handoffId,
        stateRevision: handoff.stateRevision,
        decision,
        now: now(),
      });
    },
  };
}

export function createPrismaCommerceConfirmationStore({ db = prisma } = {}) {
  return {
    async issue(data) {
      try {
        return await db.commerceConfirmation.create({ data });
      } catch (error) {
        if (error?.code !== "P2002") throw error;
        const existing = await db.commerceConfirmation.findFirst({
          where: { shopId: data.shopId, handoffId: data.handoffId },
        });
        if (!existing) throw error;
        return existing;
      }
    },

    async decide(input) {
      const current = await findExact(db, input);
      if (!current) return { status: "missing", receipt: null };
      if (current.expiresAt <= input.now) {
        await transitionPending(db, current, CONFIRMATION_STATES.EXPIRED, {
          decidedAt: input.now,
        });
        return { status: "expired", receipt: current.receipt };
      }
      if (current.status !== CONFIRMATION_STATES.PENDING) {
        return { status: "reused", receipt: current.receipt };
      }
      const nextState =
        input.decision === "decline"
          ? CONFIRMATION_STATES.DECLINED
          : CONFIRMATION_STATES.CONSUMED;
      const updated = await transitionPending(db, current, nextState, {
        decidedAt: input.now,
        ...(nextState === CONFIRMATION_STATES.CONSUMED
          ? { consumedAt: input.now }
          : {}),
      });
      if (!updated) return { status: "reused", receipt: current.receipt };
      return {
        status:
          nextState === CONFIRMATION_STATES.DECLINED ? "declined" : "accepted",
        receipt: current.receipt,
      };
    },
  };
}

export function createInMemoryCommerceConfirmationStore() {
  const records = new Map();

  return {
    records,
    async issue(data) {
      const existing = [...records.values()].find(
        (item) =>
          item.shopId === data.shopId && item.handoffId === data.handoffId,
      );
      if (existing) return structuredClone(existing);
      const stamp = new Date();
      const record = {
        ...structuredClone(data),
        version: 1,
        decidedAt: null,
        consumedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      };
      records.set(record.id, record);
      return structuredClone(record);
    },
    async decide(input) {
      const current = records.get(input.id);
      if (!matchesExact(current, input)) {
        return { status: "missing", receipt: null };
      }
      if (new Date(current.expiresAt) <= input.now) {
        current.status = CONFIRMATION_STATES.EXPIRED;
        current.decidedAt = input.now;
        current.version += 1;
        return { status: "expired", receipt: structuredClone(current.receipt) };
      }
      if (current.status !== CONFIRMATION_STATES.PENDING) {
        return { status: "reused", receipt: structuredClone(current.receipt) };
      }
      if (input.decision === "decline") {
        current.status = CONFIRMATION_STATES.DECLINED;
        current.decidedAt = input.now;
        current.version += 1;
        return {
          status: "declined",
          receipt: structuredClone(current.receipt),
        };
      }
      current.status = CONFIRMATION_STATES.CONSUMED;
      current.decidedAt = input.now;
      current.consumedAt = input.now;
      current.version += 1;
      return { status: "accepted", receipt: structuredClone(current.receipt) };
    },
  };
}

async function findExact(db, input) {
  return db.commerceConfirmation.findFirst({
    where: {
      id: input.id,
      shopId: input.shopId,
      commerceSessionId: input.commerceSessionId,
      handoffId: input.handoffId,
      stateRevision: input.stateRevision,
    },
  });
}

async function transitionPending(db, current, status, changes) {
  const updated = await db.commerceConfirmation.updateMany({
    where: {
      id: current.id,
      shopId: current.shopId,
      status: CONFIRMATION_STATES.PENDING,
      version: current.version,
    },
    data: {
      ...changes,
      status,
      version: { increment: 1 },
    },
  });
  return updated.count === 1;
}

function matchesExact(record, input) {
  return Boolean(
    record &&
    record.shopId === input.shopId &&
    record.commerceSessionId === input.commerceSessionId &&
    record.handoffId === input.handoffId &&
    record.stateRevision === input.stateRevision,
  );
}

function assertContext(context, session) {
  if (!context?.shopId) throw new Error("Merchant context is required");
  if (!session?.id) throw new Error("Commerce session is required");
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== undefined && item !== null,
    ),
  );
}
