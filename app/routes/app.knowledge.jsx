import { useLoaderData } from "react-router";
import { SourceRow } from "../components/intentcart/dashboard-ui";
import { loadIntentCartDashboard } from "../merchant/dashboard.server";
import styles from "../styles/intentcart-dashboard.module.css";

export const loader = async ({ request }) => loadIntentCartDashboard(request);

export default function Knowledge() {
  const config = useLoaderData();

  return (
    <s-page>
      <ui-title-bar title="Knowledge" />

      <div className={styles.shell}>
        <header className={styles.pageIntro}>
          <div>
            <p className={styles.eyebrow}>Knowledge</p>
            <h1>Keep the source list narrow and trustworthy.</h1>
            <p>
              Start with Shopify commerce data and approved store policies. Broader
              catalogs stay out of the primary workflow until they are connected
              deliberately.
            </p>
          </div>
          <div className={styles.introActions}>
            <s-badge tone="success">2 active sources</s-badge>
          </div>
        </header>

        <section className={styles.contentSection} aria-label="Knowledge sources">
          <div className={styles.sourceList}>
            <SourceRow
              title="Shopify product catalog"
              body="Products, prices, variants, availability, images, and product details."
              status="Active"
            />
            <SourceRow
              title="Store policies and FAQs"
              body="Shipping, returns, payments, and merchant-approved answers."
              status="Active"
            />
            <SourceRow
              title="Guides and documents"
              body="Sizing guides, category education, and merchandising notes."
              status="Later"
            />
            <SourceRow
              title="Headless or custom catalogs"
              body="A future connection for Hydrogen and custom Storefront API builds."
              status="Later"
            />
          </div>
        </section>

        <footer className={styles.footerHelp}>
          <div>
            <strong>Shopify remains the live product source.</strong>
            <p>
              IntentCart does not maintain a duplicate catalog for price, inventory, or
              variants.
            </p>
          </div>
          <s-button href={config.links.adminProducts} target="auto">
            View Shopify products
          </s-button>
        </footer>
      </div>
    </s-page>
  );
}
