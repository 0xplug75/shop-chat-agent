import { useLoaderData } from "react-router";
import { getMerchantConfig } from "../merchant/merchant.server";
import styles from "../styles/intentcart-dashboard.module.css";

export const loader = async () => {
  const merchantConfig = getMerchantConfig();

  return {
    assistant: {
      name: merchantConfig.assistant.name,
      welcomeMessage: merchantConfig.assistant.welcomeMessage,
      quickActions: merchantConfig.assistant.quickActions
    },
    widget: merchantConfig.widget,
    shopping: {
      maxProducts: merchantConfig.shopping.recommendationRules.maxProducts,
      outOfStockPolicy: merchantConfig.shopping.outOfStockPolicy,
      requireVariantConfirmation: merchantConfig.shopping.recommendationRules.requireVariantConfirmation
    },
    analytics: {
      enabled: merchantConfig.analytics.enabled,
      events: merchantConfig.analytics.events
    },
    integrations: merchantConfig.integrations
  };
};

export default function Index() {
  const config = useLoaderData();
  const enabledIntegrations = Object.entries(config.integrations)
    .filter(([, integration]) => integration.enabled)
    .map(([name]) => name);

  return (
    <s-page>
      <ui-title-bar title="IntentCart" />

      <div className={styles.shell}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>AI commerce layer</p>
            <h1>IntentCart is live on your dev store.</h1>
            <p className={styles.lede}>
              Your storefront assistant is connected to Shopify catalog tools, merchant config,
              and the current dev tunnel.
            </p>
          </div>
          <div className={styles.statusPill}>
            <span className={styles.statusDot} />
            Dev mode active
          </div>
        </section>

        <section className={styles.metricsGrid} aria-label="Runtime status">
          <Metric label="Assistant" value={config.assistant.name} detail="Loaded from merchant config" />
          <Metric label="Catalog" value="MCP ready" detail="Real Shopify product search" />
          <Metric label="Recommendations" value={`${config.shopping.maxProducts} cards`} detail="Per shopper turn" />
          <Metric label="Analytics" value={config.analytics.enabled ? "Enabled" : "Off"} detail={`${config.analytics.events.length} events reserved`} />
        </section>

        <section className={styles.mainGrid}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.kicker}>Merchant config</p>
                <h2>Assistant behavior</h2>
              </div>
              <span className={styles.badge}>JSON source</span>
            </div>
            <div className={styles.configBlock}>
              <p className={styles.configLabel}>Welcome message</p>
              <p className={styles.quote}>{config.assistant.welcomeMessage}</p>
            </div>
            <div className={styles.quickActions}>
              {config.assistant.quickActions.map((action) => (
                <span key={action}>{action}</span>
              ))}
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.kicker}>Widget</p>
                <h2>Storefront surface</h2>
              </div>
              <span className={styles.badge}>{config.widget.position}</span>
            </div>
            <div className={styles.widgetPreview} style={{
              "--preview-primary": config.widget.colors.primary,
              "--preview-bg": config.widget.colors.background,
              "--preview-text": config.widget.colors.text,
              "--preview-accent": config.widget.colors.accent
            }}>
              <div className={styles.previewBubble}>Chat mode</div>
              <div className={styles.previewCard}>
                <strong>{config.assistant.name}</strong>
                <p>{config.assistant.welcomeMessage}</p>
                <button type="button">Find the right product</button>
              </div>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.kicker}>Commerce guardrails</p>
                <h2>Shopping rules</h2>
              </div>
            </div>
            <ul className={styles.ruleList}>
              <li>Recommend up to {config.shopping.maxProducts} products.</li>
              <li>{config.shopping.requireVariantConfirmation ? "Require exact variant confirmation before cart updates." : "Variant confirmation is optional."}</li>
              <li>Out-of-stock policy: {formatPolicy(config.shopping.outOfStockPolicy)}.</li>
            </ul>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.kicker}>Integrations</p>
                <h2>Reserved connectors</h2>
              </div>
            </div>
            <div className={styles.integrationGrid}>
              {Object.keys(config.integrations).map((name) => (
                <span key={name} className={config.integrations[name].enabled ? styles.integrationOn : styles.integrationOff}>
                  {name}
                </span>
              ))}
            </div>
            <p className={styles.muted}>
              {enabledIntegrations.length > 0
                ? `${enabledIntegrations.join(", ")} ready for event delivery.`
                : "Connectors are configured in schema, but no outbound delivery is active yet."}
            </p>
          </div>
        </section>

        <section className={styles.checklist}>
          <div>
            <p className={styles.kicker}>Next validation</p>
            <h2>Before Shopify deploy</h2>
          </div>
          <ol>
            <li>Open the storefront and confirm the widget appears.</li>
            <li>Check that <code>/merchant/config</code> returns 200 from the current tunnel.</li>
            <li>Send a catalog prompt and confirm product cards render.</li>
            <li>Only deploy a Shopify version after the dev store flow is stable.</li>
          </ol>
        </section>
      </div>
    </s-page>
  );
}

function Metric({ label, value, detail }) {
  return (
    <div className={styles.metric}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}

function formatPolicy(policy) {
  return policy.replaceAll("_", " ");
}
