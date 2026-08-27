import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  authorizeExperienceAction,
  reduceCommerceOutcome,
  SAGE_INTERLAB_MANIFEST_SHA256,
  SageProtocolValidationError,
  validateCommerceIntentHandoff,
  validateCommerceOutcomeEvent,
  validateCommerceResultEnvelope,
  validateDecisionExperienceInput,
  validateExperienceActionRequest,
} from "../app/services/sage-integration/protocol/1.0.0-rc.1.server";

const RELEASE = new URL(
  "../app/protocol/sage-interlab/1.0.0-rc.1/",
  import.meta.url,
);

describe("Sage interlab product conformance 1.0.0-rc.1", () => {
  it("verifies the manifest and all eight frozen artifacts", async () => {
    const bytes = await readFile(new URL("RELEASE_MANIFEST.json", RELEASE));
    expect(sha256(bytes)).toBe(SAGE_INTERLAB_MANIFEST_SHA256);
    const manifest = JSON.parse(bytes.toString("utf8"));
    expect(manifest.artifacts).toHaveLength(8);

    for (const artifact of manifest.artifacts) {
      const relative = artifact.path.split("/1.0.0-rc.1/")[1];
      expect(sha256(await readFile(new URL(relative, RELEASE))), relative).toBe(
        artifact.sha256,
      );
    }
  });

  it("passes the official fixture exactly 45/45", async () => {
    const fixture = await loadFixture();
    let positiveCases = 0;

    expect(
      validateDecisionExperienceInput(fixture.decisionExperienceInput),
    ).toBe(fixture.decisionExperienceInput);
    positiveCases += 1;
    expect(
      validateExperienceActionRequest(fixture.experienceActionRequest),
    ).toBe(fixture.experienceActionRequest);
    positiveCases += 1;
    expect(
      authorizeExperienceAction(
        fixture.experienceActionRequest,
        fixture.decisionExperienceInput,
      ).action,
    ).toBe(fixture.experienceActionRequest);
    positiveCases += 1;
    expect(
      validateCommerceIntentHandoff(fixture.commerceIntentHandoff, {
        now: new Date(fixture.referenceTime),
      }),
    ).toBe(fixture.commerceIntentHandoff);
    positiveCases += 1;

    for (const envelope of fixture.commerceResultEnvelopes) {
      expect(validateCommerceResultEnvelope(envelope)).toBe(envelope);
      positiveCases += 1;
      const outcome = reduceCommerceOutcome(envelope, {
        now: new Date(fixture.referenceTime),
      });
      expect(validateCommerceOutcomeEvent(outcome)).toBe(outcome);
      expect(outcome.outcome).toBe(
        fixture.expectedOutcomeByStatus[envelope.result.status],
      );
      positiveCases += 1;
    }
    expect(positiveCases).toBe(30);

    let negativeCases = 0;
    for (const item of fixture.negativeCases) {
      const value = applyMutations(
        resolveBase(fixture, item.base),
        item.mutations,
      );
      let thrown;
      try {
        runValidator(item, value, fixture);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, item.id).toBeInstanceOf(SageProtocolValidationError);
      expect(thrown.code, item.id).toBe(item.expectedCode);
      negativeCases += 1;
    }
    expect(negativeCases).toBe(15);
    expect(positiveCases + negativeCases).toBe(45);
  });
});

async function loadFixture() {
  return JSON.parse(
    await readFile(
      new URL("fixtures/runtime-boundaries.json", RELEASE),
      "utf8",
    ),
  );
}

function runValidator(item, value, fixture) {
  if (item.validator === "DecisionExperienceInput") {
    return validateDecisionExperienceInput(value);
  }
  if (item.validator === "AuthorizedExperienceAction") {
    return authorizeExperienceAction(
      value,
      resolveBase(fixture, item.contextBase),
    );
  }
  if (item.validator === "CommerceIntentHandoff") {
    return validateCommerceIntentHandoff(value, {
      now: new Date(item.options?.now || fixture.referenceTime),
    });
  }
  if (item.validator === "CommerceResultEnvelope") {
    return validateCommerceResultEnvelope(value);
  }
  if (item.validator === "CommerceOutcomeEvent") {
    return validateCommerceOutcomeEvent(value);
  }
  throw new Error(`Unsupported fixture validator: ${item.validator}`);
}

function resolveBase(fixture, path) {
  if (path === "decisionExperienceInput")
    return fixture.decisionExperienceInput;
  if (path === "experienceActionRequest")
    return fixture.experienceActionRequest;
  if (path === "commerceIntentHandoff") return fixture.commerceIntentHandoff;
  if (path.startsWith("commerceResultEnvelopes.")) {
    const status = path.split(".")[1];
    return fixture.commerceResultEnvelopes.find(
      (item) => item.result.status === status,
    );
  }
  if (path.startsWith("derivedOutcomeEvents.")) {
    const status = path.split(".")[1];
    const envelope = fixture.commerceResultEnvelopes.find(
      (item) => item.result.status === status,
    );
    return reduceCommerceOutcome(envelope, {
      now: new Date(fixture.referenceTime),
    });
  }
  throw new Error(`Unknown fixture base: ${path}`);
}

function applyMutations(base, mutations = []) {
  const value = structuredClone(base);
  for (const mutation of mutations) {
    const segments = mutation.path.split(".");
    const key = segments.pop();
    const owner = segments.reduce(
      (current, segment) =>
        Array.isArray(current) ? current[Number(segment)] : current[segment],
      value,
    );
    if (mutation.operation === "delete") delete owner[key];
    else owner[key] = structuredClone(mutation.value);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
