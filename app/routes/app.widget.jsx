import { useState } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import {
  formatPolicy,
  formatPosition,
} from "../components/intentcart/dashboard-format";
import {
  Fact,
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
  saveIntentCartDashboardSection(request, "widget");

export default function Widget() {
  const config = useLoaderData();
  const result = useActionData();
  const navigation = useNavigation();
  const [previewViewport, setPreviewViewport] = useState("desktop");
  const [previewOpen, setPreviewOpen] = useState(true);

  return (
    <s-page>
      <ui-title-bar title="Widget" />

      <div className={styles.shell}>
        <header className={styles.pageIntro}>
          <div>
            <p className={styles.eyebrow}>Widget</p>
            <h1>Choose the smallest useful storefront surface.</h1>
            <p>
              The Theme Editor owns placement and appearance. IntentCart owns
              the shopping behavior behind it.
            </p>
          </div>
          <div className={styles.introActions}>
            <s-button
              href={config.links.themeEditor}
              target="auto"
              variant="primary"
            >
              Customize in Theme Editor
            </s-button>
          </div>
        </header>

        <Form method="post" className={styles.contentSection}>
          <input type="hidden" name="version" value={config.version} />
          <div className={styles.widgetWorkspace}>
            <div className={styles.widgetSettings}>
              {[
                [
                  "bubble",
                  "Compact button",
                  "Low-friction launcher for most storefronts.",
                ],
                [
                  "side-panel",
                  "Floating assistant",
                  "Docked panel for comparison while shoppers browse.",
                ],
                [
                  "inline",
                  "Inline shopping block",
                  "Guided buying embedded in a landing or collection page.",
                ],
                [
                  "fullscreen",
                  "Full-screen shopping",
                  "Immersive assistant for focused journeys.",
                ],
              ].map(([value, title, body]) => (
                <label
                  className={styles.modeRow}
                  key={value}
                  aria-label={title}
                >
                  <input
                    type="radio"
                    name="layout"
                    value={value}
                    defaultChecked={config.storefront.layout === value}
                  />
                  <span>
                    <strong>{title}</strong>
                    <p>{body}</p>
                  </span>
                </label>
              ))}

              <div className={styles.inlineSettings}>
                <label className={styles.field}>
                  <span>Entry mode</span>
                  <select
                    name="entryBehavior"
                    defaultValue={config.storefront.behavior.entryBehavior}
                  >
                    <option value="auto">Automatic</option>
                    <option value="choice">Offer a choice</option>
                    <option value="direct">Open assistant directly</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Maximum proactive prompts per session</span>
                  <input
                    type="number"
                    name="maxProactivePerSession"
                    min="0"
                    max="10"
                    defaultValue={
                      config.storefront.behavior.maxProactivePerSession
                    }
                  />
                </label>
                <label className={styles.checkField}>
                  <input
                    type="checkbox"
                    name="showQuickActions"
                    defaultChecked={config.storefront.behavior.showQuickActions}
                  />
                  <span>Show quick prompts</span>
                </label>
                <label className={styles.checkField}>
                  <input
                    type="checkbox"
                    name="openOnLoad"
                    defaultChecked={config.storefront.behavior.openOnLoad}
                  />
                  <span>Open on page load</span>
                </label>
                <label className={styles.checkField}>
                  <input
                    type="checkbox"
                    name="allowFullscreen"
                    defaultChecked={config.storefront.behavior.allowFullscreen}
                  />
                  <span>Allow full-screen mode</span>
                </label>
                <label className={styles.checkField}>
                  <input
                    type="checkbox"
                    name="contextualLauncher"
                    defaultChecked={
                      config.commerce.featureFlags.contextualLauncher
                    }
                  />
                  <span>Contextual launcher feature flag</span>
                </label>
                <label className={styles.checkField}>
                  <input
                    type="checkbox"
                    name="launcherExperimentEnabled"
                    defaultChecked={config.experiments.launcherEntry.enabled}
                  />
                  <span>Launcher experiment</span>
                </label>
                <label className={styles.field}>
                  <span>Treatment traffic (%)</span>
                  <input
                    type="number"
                    name="treatmentPercentage"
                    min="0"
                    max="100"
                    defaultValue={
                      config.experiments.launcherEntry.treatmentPercentage
                    }
                  />
                </label>
                <label className={styles.checkField}>
                  <input
                    type="checkbox"
                    name="experimentKillSwitch"
                    defaultChecked={config.experiments.killSwitch}
                  />
                  <span>Experiment kill switch</span>
                </label>
              </div>

              <div className={styles.widgetFacts}>
                <Fact
                  label="Position"
                  value={formatPosition(config.storefront.position)}
                />
                <Fact
                  label="Entry"
                  value={formatPolicy(
                    config.storefront.behavior.entryBehavior || "auto",
                  )}
                />
                <Fact
                  label="Quick prompts"
                  value={
                    config.storefront.behavior.showQuickActions
                      ? "Visible"
                      : "Hidden"
                  }
                />
              </div>
            </div>

            <div className={styles.previewTool}>
              <div className={styles.previewToolbar}>
                <span>Storefront preview</span>
                <div className={styles.segmented} aria-label="Preview viewport">
                  <button
                    type="button"
                    data-active={previewViewport === "desktop"}
                    onClick={() => setPreviewViewport("desktop")}
                  >
                    Desktop
                  </button>
                  <button
                    type="button"
                    data-active={previewViewport === "mobile"}
                    onClick={() => setPreviewViewport("mobile")}
                  >
                    Mobile
                  </button>
                </div>
              </div>

              <div
                className={styles.previewStage}
                data-viewport={previewViewport}
                style={{
                  "--preview-primary": config.storefront.colors.primary,
                  "--preview-bg": config.storefront.colors.background,
                  "--preview-text": config.storefront.colors.text,
                  "--preview-accent": config.storefront.colors.accent,
                }}
              >
                <div className={styles.mockStore}>
                  <div className={styles.mockHeader}>
                    <span />
                    <strong>YOUR STORE</strong>
                    <span />
                  </div>
                  <div className={styles.mockHero}>
                    <span>New collection</span>
                    <strong>Find the right product for your routine.</strong>
                  </div>
                  <div className={styles.mockProducts}>
                    <span />
                    <span />
                    <span />
                  </div>
                </div>

                {previewOpen ? (
                  <div className={styles.assistantPreview}>
                    <div className={styles.assistantPreviewHeader}>
                      <div className={styles.assistantIdentity}>
                        <span>S</span>
                        <div>
                          <strong>{config.assistant.name}</strong>
                          <small>Shopping assistant</small>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="Minimize preview"
                        onClick={() => setPreviewOpen(false)}
                      >
                        &minus;
                      </button>
                    </div>
                    <div className={styles.assistantPreviewBody}>
                      <div className={styles.previewWelcome}>
                        <strong>What can I help you find?</strong>
                        <p>{config.assistant.welcomeMessage}</p>
                      </div>
                      <div className={styles.previewPrompts}>
                        {config.assistant.quickActions
                          .slice(0, 2)
                          .map((action) => (
                            <span key={action}>{action}</span>
                          ))}
                      </div>
                    </div>
                    <div className={styles.previewComposer}>
                      <span>Ask about products, sizing, or fit</span>
                      <b aria-hidden="true">↑</b>
                    </div>
                  </div>
                ) : (
                  <button
                    className={styles.previewLauncher}
                    type="button"
                    onClick={() => setPreviewOpen(true)}
                  >
                    <span aria-hidden="true">S</span>
                    Ask {config.assistant.name}
                  </button>
                )}
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
            <strong>Storefront controls belong in the Theme Editor.</strong>
            <p>
              Layout, position, color, launcher, and entry behavior stay close
              to the live theme preview.
            </p>
          </div>
          <s-button href={config.links.themeEditor} target="auto">
            Open Theme Editor
          </s-button>
        </footer>
      </div>
    </s-page>
  );
}
