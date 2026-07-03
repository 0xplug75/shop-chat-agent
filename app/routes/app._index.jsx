import { useLoaderData } from "react-router";
import { getMerchantConfig } from "../merchant/merchant.server";
import styles from "../styles/intentcart-dashboard.module.css";

export const loader = async () => {
  const merchantConfig = getMerchantConfig();

  return {
    assistant: {
      name: merchantConfig.assistant.name,
      personality: merchantConfig.assistant.personality,
      brandVoice: merchantConfig.assistant.brandVoice,
      welcomeMessage: merchantConfig.assistant.welcomeMessage,
      quickActions: merchantConfig.assistant.quickActions
    },
    storefront: merchantConfig.widget,
    commerce: {
      maxProducts: merchantConfig.shopping.recommendationRules.maxProducts,
      bundleStrategy: merchantConfig.shopping.bundleStrategy,
      outOfStockPolicy: merchantConfig.shopping.outOfStockPolicy,
      requireVariantConfirmation: merchantConfig.shopping.recommendationRules.requireVariantConfirmation,
      preferAvailableInventory: merchantConfig.shopping.recommendationRules.preferAvailableInventory
    }
  };
};

export default function Index() {
  const config = useLoaderData();

  return (
    <s-page>
      <ui-title-bar title="IntentCart" />

      <div className={styles.shell}>
        <section className={styles.hero} id="home">
          <div>
            <p className={styles.eyebrow}>Merchant OS foundation</p>
            <h1>Configure how your AI shopping assistant sells on your storefront.</h1>
            <p className={styles.lede}>
              IntentCart helps shoppers discover products, compare options, choose variants,
              add to cart, and continue to Shopify checkout while keeping your store as the source of truth.
            </p>
          </div>
          <div className={styles.statusPill}>
            <span className={styles.statusDot} />
            Read-only preview
          </div>
        </section>

        <nav className={styles.sectionNav} aria-label="Merchant OS sections">
          <a href="#home">Home</a>
          <a href="#assistant">Assistant</a>
          <a href="#storefront">Storefront</a>
          <a href="#knowledge">Knowledge</a>
          <a href="#commerce">Commerce</a>
        </nav>

        <section className={styles.overviewGrid} aria-label="Current setup summary">
          <SummaryCard
            label="Assistant"
            title={config.assistant.name}
            body="Your shopper-facing assistant is configured with brand voice, quick prompts, and a safe buying flow."
          />
          <SummaryCard
            label="Storefront"
            title={formatPosition(config.storefront.position)}
            body={`The chat widget uses the ${formatLayout(config.storefront.layout)} layout and reads its visual defaults from merchant config.`}
          />
          <SummaryCard
            label="Knowledge"
            title="Catalog and policies"
            body="Today, the assistant answers from your live product catalog and store policy or FAQ sources."
          />
          <SummaryCard
            label="Commerce"
            title={`${config.commerce.maxProducts} recommendations`}
            body="Cart actions are guarded by confirmation, then handed off to Shopify checkout."
          />
        </section>

        <section className={styles.futureBlock} aria-label="Future capabilities">
          <div>
            <p className={styles.kicker}>Future capabilities</p>
            <h2>What this foundation unlocks next</h2>
          </div>
          <div className={styles.futureGrid}>
            <FutureCapability title="Performance insights" body="Understand which conversations lead to product views, carts, and checkout starts." />
            <FutureCapability title="Connected apps" body="Send approved shopping moments into tools like email, analytics, and automation platforms." />
            <FutureCapability title="AI Copilot" body="Help merchants tune assistant behavior, storefront prompts, and selling rules faster." />
          </div>
        </section>

        <section className={styles.detailGrid}>
          <article className={styles.panel} id="assistant">
            <SectionHeader eyebrow="Assistant" title="How the assistant speaks" />
            <DefinitionList
              items={[
                ["Name", config.assistant.name],
                ["Personality", config.assistant.personality],
                ["Brand voice", config.assistant.brandVoice],
                ["Welcome message", config.assistant.welcomeMessage]
              ]}
            />
            <div>
              <p className={styles.configLabel}>Quick actions</p>
              <div className={styles.quickActions}>
                {config.assistant.quickActions.map((action) => (
                  <span key={action}>{action}</span>
                ))}
              </div>
            </div>
            <div className={styles.guardrailBox}>
              <p className={styles.configLabel}>Guardrails</p>
              <ul className={styles.ruleList}>
                <li>Use real store data for price, stock, variants, policies, cart, and checkout.</li>
                <li>Ask a clarifying question when the shopper intent is ambiguous.</li>
                <li>Confirm the exact item, variant, and quantity before changing the cart.</li>
              </ul>
            </div>
          </article>

          <article className={styles.panel} id="storefront">
            <SectionHeader eyebrow="Storefront" title="How the widget appears" />
            <DefinitionList
              items={[
                ["Position", formatPosition(config.storefront.position)],
                ["Layout", formatLayout(config.storefront.layout)],
                ["Open on load", config.storefront.behavior.openOnLoad ? "Enabled" : "Disabled"],
                ["Quick actions", config.storefront.behavior.showQuickActions ? "Visible" : "Hidden"]
              ]}
            />
            <div
              className={styles.widgetPreview}
              style={{
                "--preview-primary": config.storefront.colors.primary,
                "--preview-bg": config.storefront.colors.background,
                "--preview-text": config.storefront.colors.text,
                "--preview-accent": config.storefront.colors.accent
              }}
            >
              <div className={styles.previewCard}>
                <strong>{config.assistant.name}</strong>
                <p>{config.assistant.welcomeMessage}</p>
                <button type="button">{config.assistant.quickActions[0]}</button>
              </div>
              <div className={styles.previewBubble}>Chat</div>
            </div>
            <p className={styles.note}>
              Theme Editor remains the fast place for simple visual overrides. Merchant config is the durable source for defaults.
            </p>
          </article>

          <article className={styles.panel} id="knowledge">
            <SectionHeader eyebrow="Knowledge" title="What the assistant can answer from" />
            <div className={styles.sourceGrid}>
              <SourceItem title="Product catalog" status="Active" body="Products, prices, variants, availability, and product details from Shopify." />
              <SourceItem title="Store policies and FAQs" status="Active" body="Policy and FAQ answers available to the storefront assistant." />
              <SourceItem title="Documents" status="Future" body="Brand guides, merchandising notes, sizing guides, and internal product education." />
              <SourceItem title="Help center" status="Future" body="Support articles that help answer shopper questions before purchase." />
              <SourceItem title="Custom knowledge" status="Future" body="Merchant-approved instructions for selling, objections, and category guidance." />
            </div>
          </article>

          <article className={styles.panel} id="commerce">
            <SectionHeader eyebrow="Commerce" title="How buying actions are controlled" />
            <DefinitionList
              items={[
                ["Max recommendations", `${config.commerce.maxProducts} products per turn`],
                ["Bundle strategy", formatPolicy(config.commerce.bundleStrategy)],
                ["Out-of-stock policy", formatPolicy(config.commerce.outOfStockPolicy)],
                ["Availability preference", config.commerce.preferAvailableInventory ? "Prefer available inventory" : "No preference configured"],
                ["Cart confirmation", config.commerce.requireVariantConfirmation ? "Required before cart action" : "Not required"]
              ]}
            />
            <div className={styles.checkoutBox}>
              <p className={styles.configLabel}>Checkout handoff</p>
              <p>
                After a cart action succeeds, the assistant gives the shopper a clear link back to Shopify checkout.
              </p>
            </div>
          </article>
        </section>
      </div>
    </s-page>
  );
}

function SummaryCard({ label, title, body }) {
  return (
    <div className={styles.summaryCard}>
      <p>{label}</p>
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

function SectionHeader({ eyebrow, title }) {
  return (
    <div className={styles.panelHeader}>
      <div>
        <p className={styles.kicker}>{eyebrow}</p>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function DefinitionList({ items }) {
  return (
    <dl className={styles.definitionList}>
      {items.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FutureCapability({ title, body }) {
  return (
    <div className={styles.futureCard}>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function SourceItem({ title, status, body }) {
  return (
    <div className={styles.sourceItem}>
      <div>
        <strong>{title}</strong>
        <span className={status === "Active" ? styles.statusActive : styles.statusFuture}>{status}</span>
      </div>
      <p>{body}</p>
    </div>
  );
}

function formatPolicy(value) {
  return value.replaceAll("_", " ");
}

function formatPosition(value) {
  return value.replaceAll("-", " ");
}

function formatLayout(value) {
  return value.replaceAll("-", " ");
}
