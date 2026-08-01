import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import {
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
  saveIntentCartDashboardSection(request, "assistant");

export default function Assistant() {
  const config = useLoaderData();
  const result = useActionData();
  const navigation = useNavigation();

  return (
    <s-page>
      <ui-title-bar title="Assistant" />

      <div className={styles.shell}>
        <header className={styles.pageIntro}>
          <div>
            <p className={styles.eyebrow}>Assistant</p>
            <h1>Shape how {config.assistant.name} helps shoppers.</h1>
            <p>
              Keep answers direct, consistent with the store, and focused on the
              next useful buying decision.
            </p>
          </div>
          <div className={styles.introActions}>
            <s-badge tone="success">Configured</s-badge>
          </div>
        </header>

        <Form method="post" className={styles.contentSection}>
          <input type="hidden" name="version" value={config.version} />
          <div className={styles.settingsGrid}>
            <div className={styles.formFields}>
              <label className={styles.field}>
                <span>Name</span>
                <input
                  name="name"
                  defaultValue={config.assistant.name}
                  maxLength={80}
                />
              </label>
              <label className={styles.field}>
                <span>Personality</span>
                <textarea
                  name="personality"
                  defaultValue={config.assistant.personality}
                  maxLength={2000}
                  rows={3}
                />
              </label>
              <label className={styles.field}>
                <span>Brand voice</span>
                <textarea
                  name="brandVoice"
                  defaultValue={config.assistant.brandVoice}
                  maxLength={2000}
                  rows={3}
                />
              </label>
              <label className={styles.field}>
                <span>Welcome message</span>
                <textarea
                  name="welcomeMessage"
                  defaultValue={config.assistant.welcomeMessage}
                  maxLength={1000}
                  rows={3}
                />
              </label>
            </div>

            <div className={styles.formFieldsSubdued}>
              <label className={styles.field}>
                <span>Quick prompts</span>
                <textarea
                  name="quickActions"
                  defaultValue={config.assistant.quickActions.join("\n")}
                  rows={5}
                />
                <small>One prompt per line, up to eight.</small>
              </label>
              <label className={styles.field}>
                <span>LLM routing</span>
                <select
                  name="providerPreference"
                  defaultValue={config.assistant.providerPreference}
                >
                  <option value="auto">Automatic fallback</option>
                  <option value="openai">OpenAI first</option>
                  <option value="kimi">Kimi first</option>
                </select>
              </label>
              <div>
                <p className={styles.label}>Commerce guardrails</p>
                <ul className={styles.ruleList}>
                  <li>Shopify data is authoritative.</li>
                  <li>Recommendations are limited to three products.</li>
                  <li>Variant and quantity confirmation is mandatory.</li>
                  <li>
                    Checkout is handed back to Shopify or an approved UCP flow.
                  </li>
                </ul>
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
            <strong>
              Assistant behavior stays separate from storefront styling.
            </strong>
            <p>
              Visual widget changes never rewrite Sage&apos;s commerce rules or
              source of truth.
            </p>
          </div>
        </footer>
      </div>
    </s-page>
  );
}
