/* eslint-disable react/prop-types */
import styles from "../../styles/intentcart-dashboard.module.css";

export function SetupStep({
  number,
  title,
  body,
  status,
  tone,
  href,
  action,
  external = false,
}) {
  return (
    <div className={styles.setupStep}>
      <span className={styles.stepNumber}>{number}</span>
      <div className={styles.stepCopy}>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
      <s-badge tone={tone}>{status}</s-badge>
      <s-button href={href} target={external ? "auto" : undefined}>
        {action}
      </s-button>
    </div>
  );
}

export function StatusItem({ label, value, detail }) {
  return (
    <div className={styles.statusItem}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function DefinitionRow({ label, value }) {
  return (
    <div className={styles.definitionRow}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ModeRow({ title, body, active }) {
  return (
    <div className={styles.modeRow} data-active={active}>
      <span className={styles.modeRadio} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
      <small>{active ? "Default" : "Available"}</small>
    </div>
  );
}

export function Fact({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function SourceRow({ title, body, status }) {
  return (
    <div className={styles.sourceRow}>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
      <s-badge tone={status === "Active" ? "success" : undefined}>
        {status}
      </s-badge>
    </div>
  );
}

export function JourneyStep({ number, title, body }) {
  return (
    <div className={styles.journeyStep}>
      <span>{number}</span>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

export function SettingsFeedback({ result }) {
  if (!result?.message && !result?.error) return null;
  return (
    <p
      className={styles.settingsFeedback}
      data-tone={result.ok ? "success" : "critical"}
      role={result.ok ? "status" : "alert"}
    >
      {result.message || result.error}
    </p>
  );
}

export function SaveSettingsButton({ submitting }) {
  return (
    <button className={styles.saveButton} type="submit" disabled={submitting}>
      {submitting ? "Saving..." : "Save"}
    </button>
  );
}
