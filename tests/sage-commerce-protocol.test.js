import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  COMMERCE_RESULT_STATUSES,
  outcomeForCommerceStatus,
  reduceCommerceOutcome,
  SAGE_INTERLAB_MANIFEST_SHA256,
  SageProtocolValidationError,
  validateCommerceIntentHandoff,
  validateCommerceOutcomeEvent,
  validateCommerceResultEnvelope,
} from "../app/services/commerce/sage-protocol.server";

const RELEASE = new URL(
  "../app/protocol/sage-interlab/1.0.0-rc.1/",
  import.meta.url,
);

describe("Sage interlab Commerce protocol 1.0.0-rc.1", () => {
  it("keeps the local immutable snapshot byte-identical to the frozen release", async () => {
    const manifestBytes = await readFile(
      new URL("RELEASE_MANIFEST.json", RELEASE),
    );
    expect(sha256(manifestBytes)).toBe(SAGE_INTERLAB_MANIFEST_SHA256);

    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    expect(manifest.protocolVersion).toBe("1.0.0-rc.1");
    expect(manifest.contractFreeze).toBe(true);
    for (const artifact of manifest.artifacts) {
      const relative = artifact.path.split("/1.0.0-rc.1/")[1];
      const bytes = await readFile(new URL(relative, RELEASE));
      expect(sha256(bytes), relative).toBe(artifact.sha256);
    }
  });

  it("accepts all 13 frozen Commerce results and reduces each status exactly", async () => {
    const fixture = await loadFixture();
    const statuses = [];
    for (const envelope of fixture.commerceResultEnvelopes) {
      expect(validateCommerceResultEnvelope(envelope)).toBe(envelope);
      const event = reduceCommerceOutcome(envelope, {
        now: new Date(fixture.referenceTime),
      });
      expect(validateCommerceOutcomeEvent(event)).toBe(event);
      expect(event.outcome).toBe(
        fixture.expectedOutcomeByStatus[envelope.result.status],
      );
      expect(outcomeForCommerceStatus(envelope.result.status)).toBe(
        event.outcome,
      );
      statuses.push(envelope.result.status);
    }
    expect(statuses).toEqual(COMMERCE_RESULT_STATUSES);
  });

  it("accepts the frozen CommerceIntentHandoff at its reference time", async () => {
    const fixture = await loadFixture();
    expect(
      validateCommerceIntentHandoff(fixture.commerceIntentHandoff, {
        now: new Date(fixture.referenceTime),
        expectedStateRevision: 7,
      }),
    ).toEqual(fixture.commerceIntentHandoff);
  });

  it("rejects every frozen Commerce negative case with its expected code", async () => {
    const fixture = await loadFixture();
    const cases = fixture.negativeCases.filter((item) =>
      item.validator.startsWith("Commerce"),
    );
    expect(cases).toHaveLength(11);

    for (const item of cases) {
      const value = applyMutations(
        resolveBase(fixture, item.base),
        item.mutations,
      );
      const validate = validatorFor(item.validator);
      let thrown;
      try {
        validate(value, item.options || {});
      } catch (error) {
        thrown = error;
      }
      expect(thrown, item.id).toBeInstanceOf(SageProtocolValidationError);
      expect(thrown.code, item.id).toBe(item.expectedCode);
    }
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

function validatorFor(name) {
  if (name === "CommerceIntentHandoff") {
    return (value, options) =>
      validateCommerceIntentHandoff(value, {
        now: new Date(options.now || "2026-08-08T12:00:00.000Z"),
      });
  }
  if (name === "CommerceResultEnvelope") return validateCommerceResultEnvelope;
  if (name === "CommerceOutcomeEvent") return validateCommerceOutcomeEvent;
  throw new Error(`Unsupported validator ${name}`);
}

function resolveBase(fixture, path) {
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
  throw new Error(`Unknown fixture base ${path}`);
}

function applyMutations(base, mutations = []) {
  const value = structuredClone(base);
  for (const mutation of mutations) {
    const segments = mutation.path.split(".");
    const key = segments.pop();
    const owner = segments.reduce(
      (current, segment) => current[segment],
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
