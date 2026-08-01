import { createHash, randomUUID } from "node:crypto";
import prisma from "../db.server";

export const SIDE_EFFECT_STATES = Object.freeze({
  NONE: "no_side_effect",
  REQUESTED: "side_effect_requested",
  STARTED: "side_effect_started",
  CONFIRMED: "side_effect_confirmed",
  UNKNOWN: "side_effect_unknown",
  FAILED: "side_effect_failed",
});

const PERSISTED_STATES = new Set([
  SIDE_EFFECT_STATES.REQUESTED,
  SIDE_EFFECT_STATES.STARTED,
  SIDE_EFFECT_STATES.CONFIRMED,
  SIDE_EFFECT_STATES.UNKNOWN,
  SIDE_EFFECT_STATES.FAILED,
]);

export class CommerceMutationError extends Error {
  constructor(
    code,
    message,
    {
      status = 409,
      state = SIDE_EFFECT_STATES.NONE,
      retryable = false,
      cause,
    } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "CommerceMutationError";
    this.code = code;
    this.status = status;
    this.sideEffectState = state;
    this.retryable = retryable;
    this.publicMessage =
      state === SIDE_EFFECT_STATES.UNKNOWN ||
      state === SIDE_EFFECT_STATES.STARTED
        ? "The cart update could not be verified. Check the cart before trying again."
        : "The cart could not be updated.";
  }
}

export function createTurnSideEffectState() {
  let state = SIDE_EFFECT_STATES.NONE;
  let started = false;

  return {
    get state() {
      return state;
    },
    get started() {
      return started;
    },
    observe(nextState) {
      if (
        nextState !== SIDE_EFFECT_STATES.NONE &&
        !PERSISTED_STATES.has(nextState)
      ) {
        throw new Error(`Unknown side-effect state: ${nextState}`);
      }
      state = nextState;
      if (
        [
          SIDE_EFFECT_STATES.STARTED,
          SIDE_EFFECT_STATES.CONFIRMED,
          SIDE_EFFECT_STATES.UNKNOWN,
          SIDE_EFFECT_STATES.FAILED,
        ].includes(nextState)
      ) {
        started = true;
      }
      return state;
    },
    canFallback() {
      return !started;
    },
  };
}

export function createCommerceMutationCoordinator({
  store = createPrismaCommerceMutationStore(),
  now = () => new Date(),
} = {}) {
  return {
    async execute({
      context,
      commerceSessionId,
      confirmationId,
      operation,
      request,
      perform,
      sideEffectState = createTurnSideEffectState(),
    }) {
      assertMutationInput({
        context,
        commerceSessionId,
        confirmationId,
        operation,
        perform,
      });
      const safeRequest = redactAndBound(request);
      const requestHash = hashJson(safeRequest);
      const idempotencyKey = createCommerceIdempotencyKey({
        shopId: context.shopId,
        commerceSessionId,
        confirmationId,
        operation,
      });

      sideEffectState.observe(SIDE_EFFECT_STATES.REQUESTED);
      const reservation = await store.reserve({
        shopId: context.shopId,
        commerceSessionId,
        confirmationId,
        idempotencyKey,
        requestHash,
        operation,
        state: SIDE_EFFECT_STATES.REQUESTED,
        request: safeRequest,
      });
      let record = reservation.record;
      assertReservationMatches(record, {
        commerceSessionId,
        requestHash,
        operation,
      });

      if (record.state === SIDE_EFFECT_STATES.CONFIRMED) {
        sideEffectState.observe(SIDE_EFFECT_STATES.CONFIRMED);
        return {
          status: "replayed",
          idempotencyKey,
          result: record.result,
          mutation: publicMutation(record),
        };
      }
      blockResolvedOrUncertain(record, sideEffectState);

      record = await store.transition({
        id: record.id,
        shopId: context.shopId,
        from: SIDE_EFFECT_STATES.REQUESTED,
        to: SIDE_EFFECT_STATES.STARTED,
        changes: { startedAt: now(), errorCode: null },
      });
      if (record?.state !== SIDE_EFFECT_STATES.STARTED) {
        if (record?.state === SIDE_EFFECT_STATES.CONFIRMED) {
          sideEffectState.observe(SIDE_EFFECT_STATES.CONFIRMED);
          return {
            status: "replayed",
            idempotencyKey,
            result: record.result,
            mutation: publicMutation(record),
          };
        }
        blockResolvedOrUncertain(record, sideEffectState);
        throw new CommerceMutationError(
          "SIDE_EFFECT_CONCURRENCY_CONFLICT",
          "Commerce mutation could not acquire its execution barrier",
          { state: record?.state || SIDE_EFFECT_STATES.UNKNOWN },
        );
      }

      sideEffectState.observe(SIDE_EFFECT_STATES.STARTED);
      let performedResult;
      try {
        performedResult = await perform({ idempotencyKey });
      } catch (cause) {
        const definitive = isDefinitivePreMutationFailure(cause);
        const failureState = definitive
          ? SIDE_EFFECT_STATES.FAILED
          : SIDE_EFFECT_STATES.UNKNOWN;
        try {
          await store.transition({
            id: record.id,
            shopId: context.shopId,
            from: SIDE_EFFECT_STATES.STARTED,
            to: failureState,
            changes: {
              errorCode: safeErrorCode(cause),
              resolvedAt: now(),
            },
          });
        } catch (_persistenceError) {
          // Leaving STARTED is conservative: every retry remains blocked.
        }
        sideEffectState.observe(failureState);
        throw new CommerceMutationError(
          definitive ? "SIDE_EFFECT_FAILED" : "SIDE_EFFECT_UNKNOWN",
          definitive
            ? "Commerce mutation failed before Shopify accepted it"
            : "Commerce mutation outcome is unknown",
          {
            status: definitive ? Number(cause?.status || 409) : 409,
            state: failureState,
            retryable: false,
            cause,
          },
        );
      }

      const safeResult = redactAndBound(performedResult);
      try {
        record = await store.transition({
          id: record.id,
          shopId: context.shopId,
          from: SIDE_EFFECT_STATES.STARTED,
          to: SIDE_EFFECT_STATES.CONFIRMED,
          changes: {
            result: safeResult,
            resolvedAt: now(),
            errorCode: null,
          },
        });
      } catch (cause) {
        throw new CommerceMutationError(
          "SIDE_EFFECT_RESULT_NOT_PERSISTED",
          "Shopify result could not be journaled",
          {
            status: 503,
            state: SIDE_EFFECT_STATES.STARTED,
            retryable: false,
            cause,
          },
        );
      }
      if (record?.state !== SIDE_EFFECT_STATES.CONFIRMED) {
        throw new CommerceMutationError(
          "SIDE_EFFECT_RESULT_NOT_PERSISTED",
          "Shopify result was not durably confirmed",
          {
            status: 503,
            state: record?.state || SIDE_EFFECT_STATES.STARTED,
            retryable: false,
          },
        );
      }

      sideEffectState.observe(SIDE_EFFECT_STATES.CONFIRMED);
      return {
        status: "executed",
        idempotencyKey,
        result: record.result,
        mutation: publicMutation(record),
      };
    },
  };
}

export function createPrismaCommerceMutationStore({ db = prisma } = {}) {
  return {
    async reserve(data) {
      try {
        return {
          created: true,
          record: await db.commerceMutation.create({ data }),
        };
      } catch (error) {
        if (error?.code !== "P2002") throw error;
        const record = await db.commerceMutation.findFirst({
          where: {
            shopId: data.shopId,
            OR: [
              { idempotencyKey: data.idempotencyKey },
              {
                confirmationId: data.confirmationId,
                operation: data.operation,
              },
            ],
          },
        });
        if (!record) throw error;
        return { created: false, record };
      }
    },

    async transition({ id, shopId, from, to, changes }) {
      const updated = await db.commerceMutation.updateMany({
        where: { id, shopId, state: from },
        data: {
          ...changes,
          state: to,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        return db.commerceMutation.findFirst({ where: { id, shopId } });
      }
      return db.commerceMutation.findFirst({ where: { id, shopId } });
    },
  };
}

export function createInMemoryCommerceMutationStore() {
  const records = new Map();

  return {
    records,
    async reserve(data) {
      const existing = [...records.values()].find(
        (record) =>
          record.shopId === data.shopId &&
          (record.idempotencyKey === data.idempotencyKey ||
            (record.confirmationId === data.confirmationId &&
              record.operation === data.operation)),
      );
      if (existing)
        return { created: false, record: structuredClone(existing) };
      const now = new Date();
      const record = {
        id: randomUUID(),
        result: null,
        errorCode: null,
        startedAt: null,
        resolvedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        ...structuredClone(data),
      };
      records.set(record.id, record);
      return { created: true, record: structuredClone(record) };
    },
    async transition({ id, shopId, from, to, changes }) {
      const current = records.get(id);
      if (!current || current.shopId !== shopId || current.state !== from) {
        return current ? structuredClone(current) : null;
      }
      const updated = {
        ...current,
        ...structuredClone(changes),
        state: to,
        version: current.version + 1,
        updatedAt: new Date(),
      };
      records.set(id, updated);
      return structuredClone(updated);
    },
  };
}

export function createCommerceIdempotencyKey({
  shopId,
  commerceSessionId,
  confirmationId,
  operation,
}) {
  return `commerce:v1:${createHash("sha256")
    .update(`${shopId}:${commerceSessionId}:${confirmationId}:${operation}`)
    .digest("hex")}`;
}

function assertMutationInput({
  context,
  commerceSessionId,
  confirmationId,
  operation,
  perform,
}) {
  if (!context?.shopId) throw new Error("Merchant context is required");
  if (!commerceSessionId) throw new Error("Commerce session is required");
  if (!confirmationId) throw new Error("Exact confirmation is required");
  if (!operation) throw new Error("Commerce operation is required");
  if (typeof perform !== "function")
    throw new Error("Commerce mutation performer is required");
}

function assertReservationMatches(record, expected) {
  if (
    !record ||
    record.commerceSessionId !== expected.commerceSessionId ||
    record.requestHash !== expected.requestHash ||
    record.operation !== expected.operation
  ) {
    throw new CommerceMutationError(
      "IDEMPOTENCY_CONFLICT",
      "Confirmation was reused for a different commerce mutation",
      { status: 409, state: record?.state || SIDE_EFFECT_STATES.NONE },
    );
  }
}

function blockResolvedOrUncertain(record, sideEffectState) {
  if (!record) return;
  sideEffectState.observe(record.state);
  if (
    [SIDE_EFFECT_STATES.STARTED, SIDE_EFFECT_STATES.UNKNOWN].includes(
      record.state,
    )
  ) {
    throw new CommerceMutationError(
      record.state === SIDE_EFFECT_STATES.UNKNOWN
        ? "SIDE_EFFECT_UNKNOWN"
        : "SIDE_EFFECT_IN_PROGRESS",
      "Commerce mutation is not safe to replay",
      { state: record.state, retryable: false },
    );
  }
  if (record.state === SIDE_EFFECT_STATES.FAILED) {
    throw new CommerceMutationError(
      "SIDE_EFFECT_PREVIOUSLY_FAILED",
      "Commerce mutation previously failed",
      { state: record.state, retryable: false },
    );
  }
}

function isDefinitivePreMutationFailure(error) {
  return ["AUTH_REQUIRED", "TOOL_NOT_AVAILABLE", "INVALID_TOOL_INPUT"].includes(
    String(error?.code || ""),
  );
}

function safeErrorCode(error) {
  return String(error?.code || "COMMERCE_MUTATION_FAILED")
    .replace(/[^A-Z0-9_-]/gi, "_")
    .slice(0, 128);
}

function publicMutation(record) {
  return {
    id: record.id,
    operation: record.operation,
    state: record.state,
    confirmationId: record.confirmationId,
    idempotencyKey: record.idempotencyKey,
  };
}

function hashJson(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function redactAndBound(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) {
    return value.slice(0, 250).map((item) => redactAndBound(item, depth + 1));
  }
  if (typeof value === "string") return value.slice(0, 10_000);
  if (typeof value !== "object") return value;
  const blocked =
    /(authorization|cookie|access.?token|refresh.?token|secret|password|email|phone|address|buyer.?identity)/i;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !blocked.test(key))
      .slice(0, 250)
      .map(([key, item]) => [key, redactAndBound(item, depth + 1)]),
  );
}
