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
            <p className={styles.eyebrow}>Storefront assistant</p>
            <h1>Your AI shopping assistant is ready to guide shoppers.</h1>
            <p className={styles.lede}>
              Sage can search your Shopify catalog, compare options, confirm variants,
              add products to cart, and hand shoppers back to Shopify checkout.
            </p>
          </div>
          <div className={styles.statusPill}>
            <span className={styles.statusDot} />
            Live preview
          </div>
        </section>

        <section className={styles.statusGrid} aria-label="Installation status">
          <StatusCard label="Assistant" value="Live" tone="good" />
          <StatusCard label="Widget" value="Active" tone="good" />
          <StatusCard label="Catalog" value="Connected" tone="good" />
          <StatusCard label="Checkout" value="Ready" tone="good" />
        </section>

        <nav className={styles.sectionNav} aria-label="Merchant OS sections">
          <a href="#home">Home</a>
          <a href="#assistant">Assistant</a>
          <a href="#storefront">Widget</a>
          <a href="#knowledge">Knowledge</a>
          <a href="#commerce">Commerce</a>
        </nav>

        <section className={styles.actionPanel} aria-label="Current setup summary">
          <div>
            <p className={styles.kicker}>Current setup</p>
            <h2>What shoppers can do today</h2>
            <p>
              Open the widget, describe what they need, receive product recommendations,
              choose in chat, and continue to Shopify checkout.
            </p>
          </div>
          <div className={styles.actionGrid}>
            <SummaryCard label="Assistant" title={config.assistant.name} body="Brand voice and safe shopping flow are configured." />
            <SummaryCard label="Widget type" title={formatLayout(config.storefront.layout)} body={`Shown ${formatPosition(config.storefront.position)} from the Theme Editor settings.`} />
            <SummaryCard label="Recommendations" title={`${config.commerce.maxProducts} products`} body="Short product sets keep the buying decision focused." />
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
            <SectionHeader eyebrow="Widget" title="How the assistant appears on the storefront" />
            <div className={styles.widgetModes}>
              <WidgetMode
                title="Bubble"
                active={config.storefront.layout === "bubble"}
                body="Small floating launcher. Best default for most stores."
              />
              <WidgetMode
                title="Side panel"
                active={config.storefront.layout === "side-panel"}
                body="Right-side assistant for guided shopping while browsing."
              />
              <WidgetMode
                title="Inline section"
                active={config.storefront.layout === "inline"}
                body="Assistant appears inside the page flow after the hero."
              />
              <WidgetMode
                title="Fullscreen"
                active={config.storefront.layout === "fullscreen"}
                body="Direct AI shopping mode for campaign or landing pages."
              />
            </div>
            <DefinitionList
              items={[
                ["Position", formatPosition(config.storefront.position)],
                ["Type", formatLayout(config.storefront.layout)],
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
              Use the Shopify Theme Editor for quick visual changes. IntentCart keeps assistant behavior and commerce rules in merchant config.
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

        <section className={styles.futureBlock} aria-label="Future capabilities">
          <div>
            <p className={styles.kicker}>Later</p>
            <h2>Next capabilities stay behind this control center</h2>
          </div>
          <div className={styles.futureGrid}>
            <FutureCapability title="Performance insights" body="Understand which conversations lead to product views, carts, and checkout starts." />
            <FutureCapability title="Connected apps" body="Send approved shopping moments into tools like email, analytics, and automation platforms." />
            <FutureCapability title="AI Copilot" body="Help merchants tune assistant behavior, storefront prompts, and selling rules faster." />
          </div>
        </section>
      </div>
    </s-page>
  );
}

function StatusCard({ label, value, tone }) {
  return (
    <div className={styles.statusCard} data-tone={tone}>
      <span />
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
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

function WidgetMode({ title, body, active }) {
  return (
    <div className={active ? styles.widgetModeActive : styles.widgetMode}>
      <strong>{title}</strong>
      <p>{body}</p>
      <span>{active ? "Active" : "Available"}</span>
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
