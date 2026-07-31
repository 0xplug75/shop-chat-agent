import { useLoaderData } from "react-router";
import {
  formatLayout,
  formatPosition
} from "../components/intentcart/dashboard-format";
import { SetupStep, StatusItem } from "../components/intentcart/dashboard-ui";
import { loadIntentCartDashboard } from "../merchant/dashboard.server";
import styles from "../styles/intentcart-dashboard.module.css";

export const loader = async ({ request }) => loadIntentCartDashboard(request);

export default function Index() {
  const config = useLoaderData();

  return (
    <s-page>
      <ui-title-bar title="IntentCart" />

      <div className={styles.shell}>
        <header className={styles.pageIntro}>
          <div>
            <p className={styles.eyebrow}>AI shopping assistant</p>
            <h1>Guide shoppers from a question to Shopify checkout.</h1>
            <p>
              Configure Sage here, control its storefront appearance in the Theme
              Editor, and keep products, prices, inventory, cart, and checkout grounded
              in Shopify.
            </p>
          </div>
          <div className={styles.introActions}>
            <s-button href={config.links.themeEditor} target="auto" variant="primary">
              Open Theme Editor
            </s-button>
            <s-button href={config.links.storefront} target="auto">
              Preview storefront
            </s-button>
          </div>
        </header>

        <section className={styles.launchPanel} aria-labelledby="launch-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.kicker}>Launch checklist</p>
              <h2 id="launch-title">Finish the storefront setup</h2>
            </div>
            <s-badge tone="info">Theme Editor step</s-badge>
          </div>

          <div className={styles.setupList}>
            <SetupStep
              number="1"
              title={`${config.assistant.name} is configured`}
              body="Voice, welcome message, and shopping prompts are available to the widget."
              status="Configured"
              tone="success"
              href="/app/assistant"
              action="Review"
            />
            <SetupStep
              number="2"
              title="Shopify catalog is the product source"
              body="Recommendations use live Shopify product data rather than a duplicate catalog."
              status="Shopify source"
              tone="success"
              href={config.links.adminProducts}
              action="View products"
              external
            />
            <SetupStep
              number="3"
              title="Add the widget to the active theme"
              body="Activate the IntentCart app embed, choose a widget type, and save the theme."
              status="Verify in theme"
              href={config.links.themeEditor}
              action="Open editor"
              external
            />
            <SetupStep
              number="4"
              title="Run one complete buying test"
              body="Search, compare, confirm a variant, add to cart, and open Shopify checkout."
              status="Test manually"
              href={config.links.storefront}
              action="Test storefront"
              external
            />
          </div>
        </section>

        <section className={styles.statusStrip} aria-label="Current configuration">
          <StatusItem
            label="Assistant"
            value={config.assistant.name}
            detail="Configured"
          />
          <StatusItem
            label="Widget default"
            value={formatLayout(config.storefront.layout)}
            detail={formatPosition(config.storefront.position)}
          />
          <StatusItem
            label="Recommendations"
            value={`Up to ${config.commerce.maxProducts}`}
            detail="Focused results"
          />
          <StatusItem
            label="Checkout"
            value="Shopify handoff"
            detail="After confirmation"
          />
        </section>
      </div>
    </s-page>
  );
}
