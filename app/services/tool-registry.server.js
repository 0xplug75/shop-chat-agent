import { randomUUID } from "node:crypto";
import {
  CheckoutHandoffInputSchema,
  CompareProductsInputSchema,
  GetCartInputSchema,
  KnowledgeSearchInputSchema,
  ProductDetailsInputSchema,
  PurchaseCandidateSchema,
  SearchCatalogInputSchema,
  UpdateCartInputSchema,
  formatZodError,
} from "../contracts/commerce.schemas.server";

export class ToolExecutionError extends Error {
  constructor(code, message, { status = 400, details } = {}) {
    super(message);
    this.name = "ToolExecutionError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.publicMessage = "The requested store action could not be completed.";
  }
}

export function createToolRegistry({
  commerceProvider,
  catalogAdapter,
  policyAdapter,
  cartAdapter,
  checkoutAdapter,
  knowledgeService,
  mutationCoordinator,
}) {
  const provider =
    commerceProvider ||
    createLegacyProvider({
      catalogAdapter,
      policyAdapter,
      cartAdapter,
      checkoutAdapter,
    });
  const definitions = createDefinitions({
    commerceProvider: provider,
    knowledgeService,
    mutationCoordinator,
  });
  const executeDefinition = async (definition, input, execution) => {
    const parsed = definition.schema.safeParse(input);
    if (!parsed.success) {
      throw new ToolExecutionError(
        "INVALID_TOOL_INPUT",
        `Invalid input for ${definition.name}`,
        {
          details: formatZodError(parsed.error),
        },
      );
    }

    const result = await definition.handler(parsed.data, execution);
    return { ...result, provider: provider.id || "legacy" };
  };

  return {
    listModelTools() {
      return definitions
        .filter((definition) => definition.modelCallable !== false)
        .map(({ name, description, inputSchema }) => ({
          name,
          description,
          input_schema: inputSchema,
        }));
    },

    async execute(name, input, execution) {
      const definition = definitions.find((item) => item.name === name);
      if (!definition) {
        throw new ToolExecutionError(
          "TOOL_NOT_ALLOWED",
          `Tool ${name} is not registered`,
          { status: 403 },
        );
      }

      return executeDefinition(definition, input, execution);
    },

    async executeModelTool(name, input, execution) {
      const definition = definitions.find((item) => item.name === name);
      if (!definition || definition.modelCallable === false) {
        throw new ToolExecutionError(
          "TOOL_NOT_ALLOWED",
          `Tool ${name} is not available to the language model`,
          { status: 403 },
        );
      }
      return executeDefinition(definition, input, execution);
    },
  };
}

function createDefinitions(adapters) {
  return [
    {
      name: "search_catalog",
      description:
        "Search the current Shopify store catalog. Returns at most three current, preferably available products.",
      schema: SearchCatalogInputSchema,
      inputSchema: objectSchema(
        {
          query: { type: "string", maxLength: 500 },
          category: { type: ["string", "null"] },
          filters: { type: "object", additionalProperties: true },
          budget: {
            type: "object",
            properties: {
              min: { type: ["number", "null"] },
              max: { type: ["number", "null"] },
              currency: { type: ["string", "null"] },
            },
          },
          availability: { type: "string", enum: ["available", "any"] },
          limit: { type: "integer", minimum: 1, maximum: 3 },
        },
        ["query"],
      ),
      handler: async (input, { session }) => {
        const response = await adapters.commerceProvider.searchCatalog({
          query: input.query,
          context: {
            buyerContext: session.buyerContext,
            catalogFilters: {
              ...input.filters,
              category: input.category,
              budget: input.budget,
              availability: input.availability,
            },
          },
        });
        const products = response.products
          .filter(
            (product) =>
              input.availability !== "available" || product.available !== false,
          )
          .slice(0, input.limit);
        return {
          type: "catalog",
          data: products,
          products,
          sessionPatch: {
            recommendedProducts: products,
            journeyStage: products.length > 1 ? "COMPARE" : "CONFIRM",
          },
        };
      },
    },
    {
      name: "get_product_details",
      description:
        "Get current Shopify details for one product already identified by its product ID.",
      schema: ProductDetailsInputSchema,
      inputSchema: objectSchema({ productId: { type: "string" } }, [
        "productId",
      ]),
      handler: async (input, { session }) => {
        const response = await adapters.commerceProvider.getProduct({
          id: input.productId,
          selected: session.recommendedProducts.find(
            (item) => productId(item) === input.productId,
          ),
          context: { buyerContext: session.buyerContext },
        });
        return { type: "product_details", data: response.product };
      },
    },
    {
      name: "retrieve_brand_knowledge",
      description:
        "Retrieve approved store policies, FAQs, guides, and merchant documents for the current shop.",
      schema: KnowledgeSearchInputSchema,
      inputSchema: objectSchema(
        {
          query: { type: "string", maxLength: 500 },
          limit: { type: "integer", minimum: 1, maximum: 8 },
          maxCharacters: { type: "integer", minimum: 500, maximum: 12000 },
        },
        ["query"],
      ),
      handler: async (input, { context, session }) => {
        const local = adapters.knowledgeService
          ? await adapters.knowledgeService.searchKnowledge(context, input)
          : [];
        if (local.length > 0) {
          return {
            type: "knowledge",
            data: local,
            references: local.map((item) => item.reference),
          };
        }
        const policy = await adapters.commerceProvider.searchPolicies({
          query: input.query,
          context: { buyerContext: session.buyerContext },
        });
        return {
          type: "knowledge",
          data: extractToolText(policy.response),
          references: [],
        };
      },
    },
    {
      name: "compare_products",
      description:
        "Compare two or three products using only current normalized Shopify facts already in the session.",
      schema: CompareProductsInputSchema,
      inputSchema: objectSchema(
        {
          productIds: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 3,
          },
          criteria: { type: "array", items: { type: "string" }, maxItems: 12 },
        },
        ["productIds"],
      ),
      handler: async (input, { session }) => {
        const products = input.productIds.map((id) =>
          session.recommendedProducts.find((item) => productId(item) === id),
        );
        if (products.some((product) => !product)) {
          throw new ToolExecutionError(
            "PRODUCT_NOT_IN_SESSION",
            "Comparison requested an unknown product",
          );
        }
        const comparison = products.map((product) => ({
          productId: productId(product),
          title: product.title,
          price: product.price || product.price_range || null,
          available: product.available !== false,
          variants: product.variants || [],
          requestedCriteria: input.criteria,
        }));
        return {
          type: "comparison",
          data: comparison,
          sessionPatch: {
            comparedProducts: comparison,
            journeyStage: "COMPARE",
          },
        };
      },
    },
    {
      name: "get_cart",
      description: "Read the current Shopify cart for this commerce session.",
      schema: GetCartInputSchema,
      inputSchema: objectSchema({ cartId: { type: "string" } }, ["cartId"]),
      handler: async (input, { session }) => {
        if (!session.cartId || input.cartId !== session.cartId) {
          throw new ToolExecutionError(
            "CART_MISMATCH",
            "Cart does not belong to this commerce session",
            { status: 403 },
          );
        }
        const result = await adapters.commerceProvider.getCart({
          cartId: input.cartId,
        });
        const resolvedCartId = result.cartId || input.cartId;
        return {
          type: "cart",
          data: result.cart,
          businessMessage: result.businessMessage,
          sessionPatch: {
            cartId: resolvedCartId,
            buyerContext: {
              ...session.buyerContext,
              cartSnapshot: result.cart,
            },
          },
        };
      },
    },
    {
      modelCallable: false,
      name: "update_cart",
      description:
        "Add a confirmed exact product variant and quantity to Shopify cart. Never call before explicit shopper confirmation.",
      schema: UpdateCartInputSchema,
      inputSchema: objectSchema(
        {
          cartId: { type: ["string", "null"] },
          productId: { type: "string" },
          variantId: { type: "string" },
          quantity: { type: "integer", minimum: 1, maximum: 99 },
          confirmed: { type: "boolean", const: true },
        },
        ["productId", "variantId", "quantity", "confirmed"],
      ),
      handler: async (
        input,
        { context, session, confirmation, sideEffectState },
      ) => {
        const product = session.recommendedProducts.find(
          (item) => productId(item) === input.productId,
        );
        const variant = product?.variants?.find(
          (item) =>
            String(item.id || item.variant_id || "") === input.variantId,
        );
        if (!product || !variant) {
          throw new ToolExecutionError(
            "INVALID_VARIANT",
            "Product variant is not part of this session",
            { status: 409 },
          );
        }
        if (variant.available === false) {
          throw new ToolExecutionError(
            "VARIANT_UNAVAILABLE",
            "Product variant is not currently available",
            { status: 409 },
          );
        }
        if (input.cartId && session.cartId && input.cartId !== session.cartId) {
          throw new ToolExecutionError(
            "CART_MISMATCH",
            "Cart does not belong to this commerce session",
            { status: 403 },
          );
        }
        const pending = findPendingConfirmation(session.pendingMessages, input);
        if (
          !pending?.confirmationId ||
          !confirmation?.accepted ||
          !confirmation.confirmationId ||
          !confirmationMatches(confirmation, input)
        ) {
          const confirmationId = randomUUID();
          return {
            type: "confirmation_required",
            data: {
              confirmationId,
              productId: input.productId,
              variantId: input.variantId,
              quantity: input.quantity,
              selectionRevision: session.version,
            },
            sessionPatch: {
              journeyStage: "CONFIRM",
              selectedProductId: input.productId,
              selectedVariantId: input.variantId,
              quantity: input.quantity,
              pendingMessages: [
                ...withoutPendingConfirmation(session.pendingMessages),
                {
                  type: "cart_confirmation",
                  confirmationId,
                  productId: input.productId,
                  variantId: input.variantId,
                  quantity: input.quantity,
                  selectionRevision: session.version,
                  requestedAt: new Date().toISOString(),
                },
              ],
            },
          };
        }

        if (!adapters.mutationCoordinator) {
          throw new ToolExecutionError(
            "MUTATION_COORDINATOR_MISSING",
            "Commerce mutation journal is not configured",
            { status: 500 },
          );
        }
        const candidate = PurchaseCandidateSchema.parse({
          version: "1.0",
          confirmationId: confirmation.confirmationId,
          selectionRevision: confirmation.selectionRevision,
          productId: input.productId,
          variantId: input.variantId,
          quantity: input.quantity,
          cartId: input.cartId || session.cartId || null,
          confirmedAt: new Date().toISOString(),
        });
        const mutation = await adapters.mutationCoordinator.execute({
          context,
          commerceSessionId: session.id,
          confirmationId: candidate.confirmationId,
          operation: "update_cart",
          request: {
            version: candidate.version,
            confirmationId: candidate.confirmationId,
            selectionRevision: candidate.selectionRevision,
            productId: candidate.productId,
            variantId: candidate.variantId,
            quantity: candidate.quantity,
            cartId: candidate.cartId,
          },
          sideEffectState,
          perform: async ({ idempotencyKey }) => {
            const upstream = await adapters.commerceProvider.addConfirmedItem({
              ...input,
              buyerContext: session.buyerContext,
              idempotencyKey,
            });
            return {
              toolName: upstream.toolName,
              cartId: upstream.cartId,
              cart: upstream.cart,
              continueUrl: upstream.continueUrl,
              status: upstream.status,
              requiresEscalation: upstream.requiresEscalation,
              messages: upstream.messages,
              warnings: upstream.warnings,
              disclosures: upstream.disclosures,
              businessMessage: upstream.businessMessage,
            };
          },
        });
        const result = mutation.result;
        const resolvedCartId = result.cartId || input.cartId || session.cartId;
        if (!resolvedCartId) {
          throw new ToolExecutionError(
            "CART_ID_MISSING",
            "Shopify did not return a cart identifier",
            { status: 502 },
          );
        }
        const checkoutUrl = result.continueUrl || findCheckoutUrl(result.cart);
        return {
          type: "cart_updated",
          data: result.cart,
          businessMessage: result.businessMessage,
          messages: result.messages,
          warnings: result.warnings,
          disclosures: result.disclosures,
          requiresEscalation: result.requiresEscalation,
          sessionPatch: {
            journeyStage: "CART",
            cartId: resolvedCartId,
            checkoutUrl: checkoutUrl || session.checkoutUrl,
            buyerContext: {
              ...session.buyerContext,
              cartSnapshot: result.cart,
            },
            pendingMessages: withoutPendingConfirmation(
              session.pendingMessages,
            ),
          },
        };
      },
    },
    {
      modelCallable: false,
      name: "create_checkout_handoff",
      description:
        "Return Shopify's official checkout handoff for the current confirmed cart.",
      schema: CheckoutHandoffInputSchema,
      inputSchema: objectSchema({ cartId: { type: "string" } }, ["cartId"]),
      handler: async (input, { session }) => {
        if (input.cartId !== session.cartId) {
          throw new ToolExecutionError(
            "CART_MISMATCH",
            "Cart does not belong to this commerce session",
            { status: 403 },
          );
        }
        const result = await adapters.commerceProvider.createCheckoutHandoff({
          cartId: input.cartId,
          cartSnapshot:
            session.buyerContext?.cartSnapshot || session.checkoutUrl,
        });
        if (!result.checkoutUrl) {
          throw new ToolExecutionError(
            "CHECKOUT_UNAVAILABLE",
            "Shopify did not return a checkout URL",
            { status: 409 },
          );
        }
        return {
          type: "checkout_handoff",
          data: { cartId: input.cartId, checkoutUrl: result.checkoutUrl },
          messages: result.messages,
          warnings: result.warnings,
          disclosures: result.disclosures,
          requiresEscalation: result.requiresEscalation,
          sessionPatch: {
            journeyStage: "CHECKOUT",
            checkoutUrl: result.checkoutUrl,
          },
        };
      },
    },
  ];
}

function createLegacyProvider({
  catalogAdapter,
  policyAdapter,
  cartAdapter,
  checkoutAdapter,
}) {
  return {
    id: "legacy",
    searchCatalog: catalogAdapter.searchCatalog,
    lookupCatalog: catalogAdapter.lookupCatalog,
    getProduct: catalogAdapter.getProduct,
    searchPolicies: policyAdapter.searchPolicies,
    getCart: cartAdapter.getCart,
    addConfirmedItem: cartAdapter.addConfirmedItem,
    createCheckoutHandoff: checkoutAdapter.createCheckoutFromCart,
  };
}

function findCheckoutUrl(value) {
  if (!value) return "";
  if (typeof value === "string") {
    try {
      return findCheckoutUrl(JSON.parse(value));
    } catch (_error) {
      return /^https:\/\//.test(value) ? value : "";
    }
  }
  if (Array.isArray(value)) {
    return value.map(findCheckoutUrl).find(Boolean) || "";
  }
  return (
    value.continue_url ||
    value.continueUrl ||
    value.checkoutUrl ||
    value.checkout_url ||
    Object.values(value).map(findCheckoutUrl).find(Boolean) ||
    ""
  );
}

function objectSchema(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

function productId(product) {
  return String(product?.productId || product?.product_id || product?.id || "");
}

function findPendingConfirmation(messages = [], input) {
  return messages.find(
    (message) =>
      message?.type === "cart_confirmation" &&
      message.productId === input.productId &&
      message.variantId === input.variantId &&
      Number(message.quantity) === Number(input.quantity),
  );
}

function withoutPendingConfirmation(messages = []) {
  return messages.filter((message) => message?.type !== "cart_confirmation");
}

function confirmationMatches(confirmation, input) {
  return (
    Boolean(confirmation.confirmationId) &&
    confirmation.productId === input.productId &&
    confirmation.variantId === input.variantId &&
    Number(confirmation.quantity) === Number(input.quantity)
  );
}

function extractToolText(response) {
  if (!response) return "";
  if (typeof response === "string") return response;
  if (Array.isArray(response.content)) {
    return response.content
      .map((item) => item?.text || item?.content || "")
      .filter(Boolean)
      .join("\n");
  }
  return JSON.stringify(response);
}
