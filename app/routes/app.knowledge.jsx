import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import {
  SaveSettingsButton,
  SettingsFeedback,
  SourceRow,
} from "../components/intentcart/dashboard-ui";
import {
  loadIntentCartDashboard,
  saveIntentCartDashboardSection,
} from "../merchant/dashboard.server";
import styles from "../styles/intentcart-dashboard.module.css";

export const loader = async ({ request }) => loadIntentCartDashboard(request);
export const action = async ({ request }) =>
  saveIntentCartDashboardSection(request, "knowledge");

export default function Knowledge() {
  const config = useLoaderData();
  const result = useActionData();
  const navigation = useNavigation();

  return (
    <s-page>
      <ui-title-bar title="Knowledge" />

      <div className={styles.shell}>
        <header className={styles.pageIntro}>
          <div>
            <p className={styles.eyebrow}>Knowledge</p>
            <h1>Keep the source list narrow and trustworthy.</h1>
            <p>
              Start with Shopify commerce data and approved store policies.
              Broader catalogs stay out of the primary workflow until they are
              connected deliberately.
            </p>
          </div>
          <div className={styles.introActions}>
            <s-badge tone="success">
              {config.knowledge.activeSourceCount} active sources
            </s-badge>
          </div>
        </header>

        <Form method="post" className={styles.contentSection}>
          <input type="hidden" name="version" value={config.version} />
          <div className={styles.sourceList}>
            <SourceRow
              title="Shopify product catalog"
              body="Products, prices, variants, availability, images, and product details."
              status="Active"
            />
            <label
              className={styles.toggleRow}
              htmlFor="policiesEnabled"
              aria-label="Store policies and FAQs"
            >
              <span>
                <strong>Store policies and FAQs</strong>
                <small>
                  Shipping, returns, payments, and approved answers.
                </small>
              </span>
              <input
                type="checkbox"
                id="policiesEnabled"
                name="policiesEnabled"
                defaultChecked={config.knowledge.policiesEnabled}
              />
            </label>
            <label
              className={styles.toggleRow}
              htmlFor="approvedDocumentsEnabled"
              aria-label="Guides and documents"
            >
              <span>
                <strong>Guides and documents</strong>
                <small>
                  Sizing guides, category education, and merchandising notes.
                </small>
              </span>
              <input
                type="checkbox"
                id="approvedDocumentsEnabled"
                name="approvedDocumentsEnabled"
                defaultChecked={config.knowledge.approvedDocumentsEnabled}
              />
            </label>
            <SourceRow
              title="Headless or custom catalogs"
              body="A future connection for Hydrogen and custom Storefront API builds."
              status="Later"
            />
          </div>
          <div className={styles.inlineSettings}>
            <label className={styles.field}>
              <span>Active vertical packs</span>
              <textarea
                name="activeVerticals"
                defaultValue={config.knowledge.activeVerticals.join("\n")}
                rows={3}
                placeholder="vertical-pack-id"
              />
              <small>One versioned pack identifier per line.</small>
            </label>
          </div>
          <div className={styles.formActions}>
            <SettingsFeedback result={result} />
            <SaveSettingsButton
              submitting={navigation.state === "submitting"}
            />
          </div>
        </Form>

        <footer className={styles.footerHelp}>
          <div>
            <strong>Shopify remains the live product source.</strong>
            <p>
              IntentCart does not maintain a duplicate catalog for price,
              inventory, or variants.
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
