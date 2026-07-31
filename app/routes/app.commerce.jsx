import { useLoaderData } from "react-router";
import { formatPolicy } from "../components/intentcart/dashboard-format";
import { DefinitionRow, JourneyStep } from "../components/intentcart/dashboard-ui";
import { loadIntentCartDashboard } from "../merchant/dashboard.server";
import styles from "../styles/intentcart-dashboard.module.css";

export const loader = async ({ request }) => loadIntentCartDashboard(request);

export default function Commerce() {
  const config = useLoaderData();

  return (
    <s-page>
      <ui-title-bar title="Commerce" />

      <div className={styles.shell}>
        <header className={styles.pageIntro}>
          <div>
            <p className={styles.eyebrow}>Commerce</p>
            <h1>Control decisions, then hand execution to Shopify.</h1>
            <p>
              IntentCart guides the purchase. Shopify remains the source of truth and
              completes the transaction.
            </p>
          </div>
          <div className={styles.introActions}>
            <s-badge>Shopify-native</s-badge>
          </div>
        </header>

        <section className={styles.contentSection} aria-label="Commerce configuration">
          <div className={styles.commerceLayout}>
            <div className={styles.commerceJourney} aria-label="Buying journey">
              <JourneyStep number="1" title="Discover" body="Understand the need." />
              <JourneyStep number="2" title="Compare" body="Explain a short list." />
              <JourneyStep
                number="3"
                title="Confirm"
                body="Verify variant and quantity."
              />
              <JourneyStep number="4" title="Cart" body="Use Shopify cart state." />
              <JourneyStep number="5" title="Checkout" body="Return to Shopify." />
            </div>

            <dl className={styles.definitionPanel}>
              <DefinitionRow
                label="Maximum recommendations"
                value={`${config.commerce.maxProducts} products per turn`}
              />
              <DefinitionRow
                label="Bundle strategy"
                value={formatPolicy(config.commerce.bundleStrategy)}
              />
              <DefinitionRow
                label="Out-of-stock behavior"
                value={formatPolicy(config.commerce.outOfStockPolicy)}
              />
              <DefinitionRow
                label="Inventory preference"
                value={
                  config.commerce.preferAvailableInventory
                    ? "Prefer available inventory"
                    : "No preference configured"
                }
              />
              <DefinitionRow
                label="Cart confirmation"
                value={
                  config.commerce.requireVariantConfirmation
                    ? "Required before cart action"
                    : "Not required"
                }
              />
            </dl>
          </div>
        </section>

        <footer className={styles.footerHelp}>
          <div>
            <strong>IntentCart recommends; Shopify transacts.</strong>
            <p>
              Product truth, cart state, and checkout execution remain inside Shopify.
            </p>
          </div>
          <s-button href={config.links.storefront} target="auto">
            Test storefront
          </s-button>
        </footer>
      </div>
    </s-page>
  );
}
