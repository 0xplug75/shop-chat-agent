import { randomUUID } from "node:crypto";
import { authorizeExperienceAction } from "./protocol/1.0.0-rc.1.server";

export const NON_LIVE_SAGE_MODE = "fixture_non_live";

export function createNonLiveFixtureCatalogPort({ products } = {}) {
  assertNonLiveAllowed();
  const catalogProducts = structuredClone(products || DEFAULT_PRODUCTS);
  return Object.freeze({
    id: "catalog-fixture-non-live",
    mode: NON_LIVE_SAGE_MODE,
    live: false,
    async search() {
      return {
        mode: NON_LIVE_SAGE_MODE,
        live: false,
        providerId: "fixture",
        sourceRef: "catalog:fixture:001",
        marketRef: "market:fixture:eur",
        products: structuredClone(catalogProducts).slice(0, 3),
      };
    },
  });
}

export function getNonLiveFixtureProducts() {
  return structuredClone(DEFAULT_PRODUCTS);
}

export function createNonLiveFixtureDecisionPort({ idFactory } = {}) {
  assertNonLiveAllowed();
  const createId = idFactory || ((prefix) => `${prefix}:${randomUUID()}`);
  return Object.freeze({
    id: "decision-fixture-non-live",
    mode: NON_LIVE_SAGE_MODE,
    live: false,
    async decide({ catalog, stateRevision }) {
      const decisionId = createId("decision");
      const selectActions = catalog.products.map((product, index) => ({
        actionId: createId(`action:select:${index + 1}`),
        actionType: "select_product",
        targetRef: product.reference.productId,
      }));
      const selectedProduct = catalog.products[0];
      if (!selectedProduct) {
        throw new Error("The non-live fixture catalog has no products");
      }
      const cartAction = {
        actionId: createId("action:cart"),
        actionType: "request_cart_add",
        targetRef: createId("handoff"),
      };
      const allowedNextActions = [...selectActions, cartAction];
      return {
        kind: "DecisionExperienceInput",
        version: "1.0",
        decisionId,
        stateRevision,
        decisionType: "recommendation",
        messageIntent: "present_shortlist",
        recommendations: {
          decisionId,
          stateRevision,
          products: catalog.products.map((product, index) => ({
            productRef: product.reference.productId,
            needMatched: ["Synthetic local intent fixture"],
            confirmedCriteriaUsed: ["criteria:fixture:intent"],
            whyCodes: ["FIXTURE_MATCH"],
            tradeoffs: ["Live catalog relevance is not verified"],
            limits: ["Synthetic fixture; not a live recommendation"],
            evidenceRefs: [`evidence:fixture:${index + 1}`],
            provenanceRefs: [product.provenanceRef],
            allowedNextActions: [
              selectActions[index].actionId,
              ...(index === 0 ? [cartAction.actionId] : []),
            ],
          })),
          selectionRationale: [
            "Deterministic ordering for local protocol integration only",
          ],
          omittedCandidateReasons: [],
        },
        systemConfidence: {
          band: "CONDITIONAL",
          intentSufficiency: "usable",
          constraintCoverage: "partial",
          evidenceCoverage: "partial",
          rankingStability: "conditional",
          sourceFreshness: "acceptable",
          calibrated: false,
          warnings: ["Non-live deterministic fixture"],
        },
        shopperConfidence: {
          band: "UNKNOWN",
          evidence: "none",
          inferredFromBehaviorOnly: false,
          nextSupport: ["COMPARE"],
        },
        allowedNextActions,
        disclosures: [
          "Synthetic non-live fixture used for local integration validation",
        ],
      };
    },
  });
}

export function createCanonicalExperienceIngressPort() {
  return Object.freeze({
    authorize({ action, decision }) {
      return authorizeExperienceAction(action, decision);
    },
  });
}

export function createCommerceBoundaryPort(boundary) {
  if (!boundary) throw new Error("Commerce boundary is required");
  return Object.freeze({
    prepare(input) {
      return boundary.prepare(input);
    },
    confirm(input) {
      return boundary.confirm(input);
    },
  });
}

function assertNonLiveAllowed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Non-live Sage adapters are disabled in production");
  }
}

const DEFAULT_PRODUCTS = Object.freeze([
  {
    reference: {
      kind: "ProductReference",
      version: "0.1-candidate",
      productId: "product:fixture:001",
      sourceRef: "catalog:fixture:001",
    },
    title: "Fixture Product One",
    canonicalUrl: "https://fixture.invalid/products/one",
    imageUrl: "https://fixture.invalid/images/one.jpg",
    provenanceRef: "provenance:fixture:001",
    variants: [
      {
        id: "variant:fixture:001",
        title: "Default",
        available: true,
        quantityAvailable: 10,
        unitPrice: { amountMinor: 2400, currency: "EUR" },
      },
    ],
  },
  {
    reference: {
      kind: "ProductReference",
      version: "0.1-candidate",
      productId: "product:fixture:002",
      sourceRef: "catalog:fixture:001",
    },
    title: "Fixture Product Two",
    canonicalUrl: "https://fixture.invalid/products/two",
    imageUrl: "https://fixture.invalid/images/two.jpg",
    provenanceRef: "provenance:fixture:002",
    variants: [
      {
        id: "variant:fixture:002",
        title: "Default",
        available: true,
        quantityAvailable: 8,
        unitPrice: { amountMinor: 3200, currency: "EUR" },
      },
    ],
  },
]);
