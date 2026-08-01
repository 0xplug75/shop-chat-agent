import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { formatPolicy } from "../components/intentcart/dashboard-format";
import {
  JourneyStep,
  SaveSettingsButton,
  SettingsFeedback,
} from "../components/intentcart/dashboard-ui";
import {
  loadIntentCartDashboard,
  saveIntentCartDashboardSection,
} from "../merchant/dashboard.server";
import styles from "../styles/intentcart-dashboard.module.css";

export const loader = async ({ request }) => loadIntentCartDashboard(request);
export const action = async ({ request }) =>
  saveIntentCartDashboardSection(request, "commerce");

export default function Commerce() {
  const config = useLoaderData();
  const result = useActionData();
  const navigation = useNavigation();

  return (
    <s-page>
      <ui-title-bar title="Commerce" />

      <div className={styles.shell}>
        <header className={styles.pageIntro}>
          <div>
            <p className={styles.eyebrow}>Commerce</p>
            <h1>Control decisions, then hand execution to Shopify.</h1>
            <p>
              IntentCart guides the purchase. Shopify remains the source of
              truth and completes the transaction.
            </p>
          </div>
          <div className={styles.introActions}>
            <s-badge>Shopify-native</s-badge>
          </div>
        </header>

        <Form method="post" className={styles.contentSection}>
          <input type="hidden" name="version" value={config.version} />
          <div className={styles.commerceLayout}>
            <div className={styles.commerceJourney} aria-label="Buying journey">
              <JourneyStep
                number="1"
                title="Discover"
                body="Understand the need."
              />
              <JourneyStep
                number="2"
                title="Compare"
                body="Explain a short list."
              />
              <JourneyStep
                number="3"
                title="Confirm"
                body="Verify variant and quantity."
              />
              <JourneyStep
                number="4"
                title="Cart"
                body="Use Shopify cart state."
              />
              <JourneyStep
                number="5"
                title="Checkout"
                body="Return to Shopify."
              />
            </div>

            <div className={styles.formFields}>
              <label className={styles.field}>
                <span>Maximum recommendations</span>
                <input
                  type="number"
                  name="maxProducts"
                  min="1"
                  max="3"
                  defaultValue={config.commerce.maxProducts}
                />
              </label>
              <label className={styles.field}>
                <span>Bundle strategy</span>
                <select
                  name="bundleStrategy"
                  defaultValue={config.commerce.bundleStrategy}
                >
                  <option value="none">None</option>
                  <option value="complementary">Complementary</option>
                  <option value="starter_kit">Starter kit</option>
                  <option value="frequently_bought_together">
                    Frequently bought together
                  </option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Bestseller priority</span>
                <select
                  name="bestsellerPriority"
                  defaultValue={config.commerce.bestsellerPriority}
                >
                  <option value="off">Off</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Out-of-stock behavior</span>
                <select
                  name="outOfStockPolicy"
                  defaultValue={config.commerce.outOfStockPolicy}
                >
                  <option value="hide">Hide unavailable products</option>
                  <option value="explain_and_suggest_alternatives">
                    Explain and suggest alternatives
                  </option>
                  <option value="show_waitlist_message">
                    Show waitlist message
                  </option>
                </select>
              </label>
              <label className={styles.checkField}>
                <input
                  type="checkbox"
                  name="preferAvailableInventory"
                  defaultChecked={config.commerce.preferAvailableInventory}
                />
                <span>Prefer available inventory</span>
              </label>
              <div className={styles.lockedSetting}>
                <span>Cart confirmation</span>
                <strong>Always required</strong>
              </div>
            </div>
          </div>

          <div className={styles.settingsGrid}>
            <div className={styles.formFields}>
              <p className={styles.label}>Provider and checkout</p>
              <label className={styles.field}>
                <span>Commerce provider</span>
                <select
                  name="commerceProvider"
                  defaultValue={config.commerce.commerceProvider}
                >
                  <option value="shopify">Shopify</option>
                  <option value="ucp">External UCP business</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Checkout strategy</span>
                <select
                  name="checkoutStrategy"
                  defaultValue={config.commerce.checkoutStrategy}
                >
                  <option value="shopify_handoff">Shopify handoff</option>
                  <option value="ucp_handoff">UCP handoff</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>UCP business URL</span>
                <input
                  type="url"
                  name="ucpBusinessUrl"
                  placeholder="https://store.example"
                  defaultValue={config.commerce.ucp.businessUrl || ""}
                />
              </label>
              <label className={styles.checkField}>
                <input
                  type="checkbox"
                  name="ucpCartEnabled"
                  defaultChecked={config.commerce.ucp.cartEnabled}
                />
                <span>UCP cart</span>
              </label>
              <label className={styles.checkField}>
                <input
                  type="checkbox"
                  name="ucpCheckoutEnabled"
                  defaultChecked={config.commerce.ucp.checkoutEnabled}
                />
                <span>UCP checkout handoff</span>
              </label>
            </div>

            <div className={styles.formFieldsSubdued}>
              <p className={styles.label}>Session recovery</p>
              <label className={styles.checkField}>
                <input
                  type="checkbox"
                  name="recoveryEnabled"
                  defaultChecked={config.commerce.recovery.enabled}
                />
                <span>Resume an eligible same-visitor session</span>
              </label>
              <label className={styles.field}>
                <span>Recovery window (hours)</span>
                <input
                  type="number"
                  name="recoveryTtlHours"
                  min="1"
                  max="168"
                  defaultValue={config.commerce.recovery.ttlHours}
                />
              </label>
              <div className={styles.lockedSetting}>
                <span>UCP checkout completion</span>
                <strong>Disabled; shopper handoff only</strong>
              </div>
              <div className={styles.lockedSetting}>
                <span>Current out-of-stock policy</span>
                <strong>
                  {formatPolicy(config.commerce.outOfStockPolicy)}
                </strong>
              </div>
            </div>
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
            <strong>IntentCart recommends; Shopify transacts.</strong>
            <p>
              Product truth, cart state, and checkout execution remain inside
              Shopify.
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
