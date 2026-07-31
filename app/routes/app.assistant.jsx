import { useLoaderData } from "react-router";
import { DefinitionRow } from "../components/intentcart/dashboard-ui";
import { loadIntentCartDashboard } from "../merchant/dashboard.server";
import styles from "../styles/intentcart-dashboard.module.css";

export const loader = async ({ request }) => loadIntentCartDashboard(request);

export default function Assistant() {
  const config = useLoaderData();

  return (
    <s-page>
      <ui-title-bar title="Assistant" />

      <div className={styles.shell}>
        <header className={styles.pageIntro}>
          <div>
            <p className={styles.eyebrow}>Assistant</p>
            <h1>Shape how {config.assistant.name} helps shoppers.</h1>
            <p>
              Keep answers direct, consistent with the store, and focused on the next
              useful buying decision.
            </p>
          </div>
          <div className={styles.introActions}>
            <s-badge tone="success">Configured</s-badge>
          </div>
        </header>

        <section className={styles.contentSection} aria-label="Assistant configuration">
          <div className={styles.twoColumn}>
            <dl className={styles.definitionPanel}>
              <DefinitionRow label="Name" value={config.assistant.name} />
              <DefinitionRow label="Personality" value={config.assistant.personality} />
              <DefinitionRow label="Brand voice" value={config.assistant.brandVoice} />
              <DefinitionRow
                label="Welcome message"
                value={config.assistant.welcomeMessage}
              />
            </dl>

            <div className={styles.rulesPanel}>
              <div>
                <p className={styles.label}>Quick prompts</p>
                <div className={styles.quickActions}>
                  {config.assistant.quickActions.map((action) => (
                    <span key={action}>{action}</span>
                  ))}
                </div>
              </div>
              <div className={styles.divider} />
              <div>
                <p className={styles.label}>Commerce guardrails</p>
                <ul className={styles.ruleList}>
                  <li>Use Shopify data for price, stock, variants, and policies.</li>
                  <li>Recommend a short list and explain the tradeoff.</li>
                  <li>Confirm item, variant, and quantity before changing the cart.</li>
                  <li>Hand the shopper back to Shopify for checkout.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <footer className={styles.footerHelp}>
          <div>
            <strong>Assistant behavior stays separate from storefront styling.</strong>
            <p>
              Visual widget changes never rewrite Sage&apos;s commerce rules or source
              of truth.
            </p>
          </div>
        </footer>
      </div>
    </s-page>
  );
}
