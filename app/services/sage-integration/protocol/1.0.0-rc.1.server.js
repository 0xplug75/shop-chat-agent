import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import Ajv2020 from "ajv/dist/2020.js";

const require = createRequire(import.meta.url);
const RELEASE_ROOT = "../../../protocol/sage-interlab/1.0.0-rc.1";
const productReferenceSchema = require(
  `${RELEASE_ROOT}/schemas/product-reference-candidate.schema.json`,
);
const clarificationQuestionSchema = require(
  `${RELEASE_ROOT}/schemas/clarification-question.schema.json`,
);
const decisionExperienceSchema = require(
  `${RELEASE_ROOT}/schemas/decision-experience-input.schema.json`,
);
const experienceActionSchema = require(
  `${RELEASE_ROOT}/schemas/experience-action-request.schema.json`,
);
const commerceHandoffSchema = require(
  `${RELEASE_ROOT}/schemas/commerce-intent-handoff.schema.json`,
);
const commerceResultSchema = require(
  `${RELEASE_ROOT}/schemas/commerce-result-envelope.schema.json`,
);
const commerceOutcomeSchema = require(
  `${RELEASE_ROOT}/schemas/commerce-outcome-event.schema.json`,
);

export const SAGE_INTERLAB_PROTOCOL_VERSION = "1.0.0-rc.1";
export const SAGE_INTERLAB_MANIFEST_SHA256 =
  "2f97927faaed19ec42477b1c93de86d14b7786c1743e84417d59fbb9bfe0652b";
export const PRODUCT_REFERENCE_WIRE_VERSION = "0.1-candidate";
export const PRODUCT_REFERENCE_INTERNAL_VERSION = "1.0";
export const COMMERCE_HANDOFF_TTL_MS = 5 * 60 * 1000;

export const COMMERCE_RESULT_STATUSES = Object.freeze([
  "denied",
  "confirmation_required",
  "confirmation_declined",
  "confirmation_expired",
  "stale_state",
  "stale_cart",
  "invalid_variant",
  "invalid_quantity",
  "price_changed",
  "unavailable",
  "failed_before_mutation",
  "outcome_unknown",
  "succeeded_authoritative",
]);

const OUTCOME_BY_STATUS = Object.freeze({
  denied: "no_mutation",
  confirmation_required: "confirmation_pending",
  confirmation_declined: "no_mutation",
  confirmation_expired: "no_mutation",
  stale_state: "no_mutation",
  stale_cart: "no_mutation",
  invalid_variant: "no_mutation",
  invalid_quantity: "no_mutation",
  price_changed: "no_mutation",
  unavailable: "no_mutation",
  failed_before_mutation: "mutation_failed",
  outcome_unknown: "mutation_unknown",
  succeeded_authoritative: "mutation_succeeded",
});

const validators = createValidators();

export class SageProtocolValidationError extends Error {
  constructor(code, message, { status = 400, details } = {}) {
    super(message);
    this.name = "SageProtocolValidationError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.publicMessage = "The Sage request is invalid or no longer current.";
  }
}

export function validateProductReferenceWire(value) {
  validateWith(validators.productReference, value, "ProductReference");
  return value;
}

export function resolveProductReferenceWire(value, trustedContext) {
  validateProductReferenceWire(value);
  const shopId = requiredTrustedRef(trustedContext?.shopId, "shopId");
  const providerId = requiredTrustedRef(
    trustedContext?.providerId,
    "providerId",
  );
  const sourceRef = requiredTrustedRef(trustedContext?.sourceRef, "sourceRef");
  if (sourceRef !== value.sourceRef) {
    throw new SageProtocolValidationError(
      "PRODUCT_REFERENCE_SCOPE_MISMATCH",
      "Product reference source is outside the authenticated catalog scope",
      { status: 403 },
    );
  }
  return Object.freeze({
    kind: "ProductReference",
    version: PRODUCT_REFERENCE_INTERNAL_VERSION,
    productId: value.productId,
    sourceRef: value.sourceRef,
    shopId,
    providerId,
  });
}

export function projectProductReferenceWire(value) {
  return validateProductReferenceWire({
    kind: "ProductReference",
    version: PRODUCT_REFERENCE_WIRE_VERSION,
    productId: value?.productId,
    sourceRef: value?.sourceRef,
  });
}

export function validateDecisionExperienceInput(value) {
  validateWith(validators.decisionExperience, value, "DecisionExperienceInput");
  if (
    value.systemConfidence.band === "STRONG" &&
    (value.systemConfidence.intentSufficiency !== "usable" ||
      value.systemConfidence.constraintCoverage !== "complete" ||
      value.systemConfidence.evidenceCoverage !== "sufficient" ||
      value.systemConfidence.rankingStability !== "stable" ||
      value.systemConfidence.sourceFreshness !== "acceptable")
  ) {
    throw new SageProtocolValidationError(
      "STRONG_CONFIDENCE_UNSUPPORTED",
      "Strong system confidence is not supported by the supplied evidence",
    );
  }
  if (
    value.recommendations &&
    (value.recommendations.decisionId !== value.decisionId ||
      value.recommendations.stateRevision !== value.stateRevision)
  ) {
    throw new SageProtocolValidationError(
      "DECISION_PROJECTION_MISMATCH",
      "Recommendation projection does not match its decision",
    );
  }
  if (
    value.comparison &&
    value.comparison.stateRevision !== value.stateRevision
  ) {
    throw new SageProtocolValidationError(
      "STALE_STATE_REVISION",
      "Comparison projection targets a stale decision revision",
      { status: 409 },
    );
  }
  return value;
}

export function validateExperienceActionRequest(value) {
  validateWith(validators.experienceAction, value, "ExperienceActionRequest");
  return value;
}

export function authorizeExperienceAction(action, decision) {
  validateDecisionExperienceInput(decision);
  validateExperienceActionRequest(action);
  if (action.decisionId !== decision.decisionId) {
    throw new SageProtocolValidationError(
      "DECISION_ID_MISMATCH",
      "Experience action does not target the active decision",
      { status: 409 },
    );
  }
  if (action.stateRevision !== decision.stateRevision) {
    throw new SageProtocolValidationError(
      "STALE_STATE_REVISION",
      "Experience action targets a stale decision revision",
      { status: 409 },
    );
  }
  const allowance = decision.allowedNextActions.find(
    (candidate) => candidate.actionId === action.actionId,
  );
  if (!allowance) {
    throw new SageProtocolValidationError(
      "ACTION_NOT_ALLOWED",
      "Experience action is not authorized by the active decision",
      { status: 403 },
    );
  }
  if (allowance.actionType !== action.actionType) {
    throw new SageProtocolValidationError(
      "ACTION_TYPE_MISMATCH",
      "Experience action type differs from the authorized action",
      { status: 403 },
    );
  }
  const targetRef = actionTargetRef(action);
  if (allowance.targetRef && allowance.targetRef !== targetRef) {
    throw new SageProtocolValidationError(
      "ACTION_TARGET_MISMATCH",
      "Experience action target differs from the authorized target",
      { status: 403 },
    );
  }
  return Object.freeze({ action, allowance });
}

export function validateCommerceIntentHandoff(
  value,
  { now = new Date(), expectedStateRevision } = {},
) {
  validateWith(validators.handoff, value, "CommerceIntentHandoff");
  const issuedAt = parseTimestamp(value.issuedAt, "issuedAt");
  const expiresAt = parseTimestamp(value.expiresAt, "expiresAt");
  const current = dateValue(now, "now");

  if (expiresAt <= current) {
    throw new SageProtocolValidationError(
      "HANDOFF_EXPIRED",
      "Commerce handoff has expired",
    );
  }
  if (expiresAt <= issuedAt || expiresAt - issuedAt > COMMERCE_HANDOFF_TTL_MS) {
    throw new SageProtocolValidationError(
      "HANDOFF_TTL_EXCEEDED",
      "Commerce handoff lifetime exceeds the frozen protocol limit",
    );
  }
  if (
    expectedStateRevision !== undefined &&
    value.stateRevision !== expectedStateRevision
  ) {
    throw new SageProtocolValidationError(
      "STALE_STATE",
      "Commerce handoff targets a stale decision state",
      {
        status: 409,
        details: { expectedRevision: expectedStateRevision },
      },
    );
  }
  return value;
}

export function validateCommerceResultEnvelope(value) {
  validateWith(validators.result, value, "CommerceResultEnvelope");
  return value;
}

export function validateCommerceOutcomeEvent(value) {
  validateWith(validators.outcome, value, "CommerceOutcomeEvent");
  return value;
}

export function createCommerceResultEnvelope(
  handoff,
  result,
  { now = new Date(), resultId = `result:${randomUUID()}` } = {},
) {
  const envelope = {
    kind: "CommerceResultEnvelope",
    version: "1.0",
    resultId,
    handoffId: handoff.handoffId,
    correlationId: handoff.correlationId,
    occurredAt: dateValue(now, "now").toISOString(),
    result,
  };
  return validateCommerceResultEnvelope(envelope);
}

export function reduceCommerceOutcome(envelope, { now = new Date() } = {}) {
  validateCommerceResultEnvelope(envelope);
  const outcome = OUTCOME_BY_STATUS[envelope.result.status];
  if (!outcome) {
    throw new SageProtocolValidationError(
      "UNSUPPORTED_COMMERCE_STATUS",
      "Commerce result cannot be reduced for Sage",
      { status: 500 },
    );
  }
  const event = {
    kind: "CommerceOutcomeEvent",
    version: "1.0",
    handoffId: envelope.handoffId,
    correlationId: envelope.correlationId,
    resultRef: envelope.resultId,
    outcome,
    occurredAt: dateValue(now, "now").toISOString(),
  };
  return validateCommerceOutcomeEvent(event);
}

export function createArgumentDigest(value) {
  return `digest:${createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")}`;
}

export function outcomeForCommerceStatus(status) {
  return OUTCOME_BY_STATUS[status] || null;
}

function createValidators() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  return {
    productReference: ajv.compile(structuredClone(productReferenceSchema)),
    decisionExperience: ajv.compile(
      replaceExternalReference(
        structuredClone(decisionExperienceSchema),
        "clarification-question.schema.json",
        stripSchemaIdentity(clarificationQuestionSchema),
      ),
    ),
    experienceAction: ajv.compile(structuredClone(experienceActionSchema)),
    handoff: ajv.compile(inlineProductReference(commerceHandoffSchema)),
    result: ajv.compile(inlineProductReference(commerceResultSchema)),
    outcome: ajv.compile(structuredClone(commerceOutcomeSchema)),
  };
}

function inlineProductReference(schema) {
  return replaceExternalReference(
    structuredClone(schema),
    "product-reference-candidate.schema.json",
    stripSchemaIdentity(productReferenceSchema),
  );
}

function replaceExternalReference(value, reference, replacement) {
  if (Array.isArray(value)) {
    return value.map((item) =>
      replaceExternalReference(item, reference, replacement),
    );
  }
  if (!value || typeof value !== "object") return value;
  if (value.$ref === reference) return structuredClone(replacement);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      replaceExternalReference(item, reference, replacement),
    ]),
  );
}

function stripSchemaIdentity(schema) {
  const copy = structuredClone(schema);
  delete copy.$schema;
  delete copy.$id;
  return copy;
}

function validateWith(validate, value, contract) {
  if (validate(value)) return;
  const errors = structuredClone(validate.errors || []);
  const code = validationCode(errors, value);
  throw new SageProtocolValidationError(
    code,
    `${contract} does not conform to ${SAGE_INTERLAB_PROTOCOL_VERSION}`,
    { details: errors.slice(0, 20) },
  );
}

function validationCode(errors, value) {
  if (
    value?.result?.status === "outcome_unknown" &&
    value.result.recovery !== "reconcile"
  ) {
    return "RECONCILIATION_REQUIRED";
  }
  if (
    value?.result?.status === "confirmation_required" &&
    value.result.receipt?.singleUse !== true
  ) {
    return "SINGLE_USE_REQUIRED";
  }
  if (
    value?.result?.status === "succeeded_authoritative" &&
    !value.result.authorityRef
  ) {
    return "INVALID_OPAQUE_REFERENCE";
  }
  if (
    Object.hasOwn(value || {}, "transcript") ||
    Object.hasOwn(value?.result || {}, "providerPayload") ||
    (value?.kind === "CommerceOutcomeEvent" &&
      Object.hasOwn(value, "mutationRef"))
  ) {
    return "PRIVATE_OR_AUTHORITATIVE_FIELD_FORBIDDEN";
  }
  if (
    errors.some(
      (error) =>
        error.keyword === "const" && error.instancePath.endsWith("/singleUse"),
    )
  ) {
    return "SINGLE_USE_REQUIRED";
  }
  if (
    errors.some(
      (error) =>
        error.keyword === "const" && error.instancePath.endsWith("/recovery"),
    )
  ) {
    return "RECONCILIATION_REQUIRED";
  }
  const requiredAuthority = errors.find(
    (error) =>
      error.keyword === "required" &&
      ["authorityRef", "commerceStateRef", "mutationRef"].includes(
        error.params?.missingProperty,
      ),
  );
  if (requiredAuthority) return "INVALID_OPAQUE_REFERENCE";
  if (
    errors.some((error) => error.instancePath.endsWith("/shopperActionIntent"))
  ) {
    return "INVALID_SHOPPER_ACTION_INTENT";
  }
  if (
    errors.some((error) =>
      error.instancePath.includes("/unresolvedCommerceInputs"),
    )
  ) {
    return "COMMERCE_INPUT_MUST_REMAIN_UNRESOLVED";
  }
  const additional = errors.find(
    (error) => error.keyword === "additionalProperties",
  );
  const field = String(additional?.params?.additionalProperty || "");
  if (
    /(transcript|provider|mutation|authority|token|secret|payment|address|email|phone)/i.test(
      field,
    )
  ) {
    return "PRIVATE_OR_AUTHORITATIVE_FIELD_FORBIDDEN";
  }
  if (additional) return "UNKNOWN_FIELD";
  return "SCHEMA_VALIDATION_FAILED";
}

function actionTargetRef(action) {
  if (
    action.actionType === "select_product" ||
    action.actionType === "ask_about_product"
  ) {
    return action.arguments.productRef;
  }
  if (
    action.actionType === "request_cart_add" ||
    action.actionType === "request_checkout_handoff"
  ) {
    return action.arguments.handoffRef;
  }
  return undefined;
}

function requiredTrustedRef(value, field) {
  if (!value || typeof value !== "string") {
    throw new SageProtocolValidationError(
      "PRODUCT_REFERENCE_CONTEXT_REQUIRED",
      `Authenticated ${field} is required to resolve ProductReference`,
      { status: 403 },
    );
  }
  return value;
}

function parseTimestamp(value, field) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new SageProtocolValidationError(
      "INVALID_TIMESTAMP",
      `${field} must be an RFC 3339 timestamp`,
    );
  }
  return parsed.getTime();
}

function dateValue(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new SageProtocolValidationError(
      "INVALID_TIMESTAMP",
      `${field} must be a valid timestamp`,
    );
  }
  return date;
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
