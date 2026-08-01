import {
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { TARGET_NETWORK } from "@shared/nox";
import { AlertIcon, CheckIcon, CopyIcon, ExternalIcon, InfoIcon } from "./icons";

/* ---------------------------------------------------------------- button */

/** `accent` is the violet "this action is about ciphertext" button. */
type ButtonVariant = "primary" | "accent" | "ghost" | "danger" | "default";

export function Button({
  variant = "default",
  size,
  block,
  loading,
  children,
  className = "",
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm";
  block?: boolean;
  loading?: boolean;
}) {
  const classes = [
    "btn",
    variant !== "default" ? `btn-${variant}` : "",
    size === "sm" ? "btn-sm" : "",
    block ? "btn-block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading && <span className="spinner" />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className="btn btn-icon" title={label} aria-label={label} {...rest}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ card */

export function Card({
  children,
  accent,
  className = "",
}: {
  children: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${accent ? "card-accent" : ""} ${className}`}>
      {children}
    </section>
  );
}

export function CardHead({
  title,
  sub,
  action,
}: {
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="card-head">
      <div className="card-title">
        <h2>{title}</h2>
        {sub && <p className="small muted">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

export function CardBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`card-body ${className}`}>{children}</div>;
}

/* ----------------------------------------------------------------- badge */

export function Badge({
  tone = "default",
  children,
}: {
  tone?: "default" | "cipher" | "plain" | "warn" | "danger" | "accent";
  children: ReactNode;
}) {
  return (
    <span className={`badge ${tone !== "default" ? `badge-${tone}` : ""}`}>
      {children}
    </span>
  );
}

export function Dot({ pulse }: { pulse?: boolean }) {
  return <span className={`dot ${pulse ? "dot-pulse" : ""}`} />;
}

/* --------------------------------------------------------------- callout */

export function Callout({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "warn" | "danger" | "ok" | "plain";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const IconFor = tone === "info" ? InfoIcon : tone === "ok" ? CheckIcon : AlertIcon;
  return (
    <div className={`callout callout-${tone}`}>
      <span className="callout-icon">
        <IconFor size={16} />
      </span>
      <div className="grow stack-sm">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
        {action && <div className="row" style={{ marginTop: 4 }}>{action}</div>}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- input */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      {children}
      {error ? (
        <span className="field-error">{error}</span>
      ) : hint ? (
        <span className="tiny faint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({
  invalid,
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={`input ${invalid ? "input-invalid" : ""} ${className}`}
      spellCheck={false}
      autoComplete="off"
      {...rest}
    />
  );
}

export function TextArea({
  className = "",
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`} spellCheck={false} {...rest} />;
}

/* ------------------------------------------------------------------ tile */

export function Tile({
  label,
  value,
  note,
  badge,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="tile">
      <span className="tile-label">
        {label}
        {badge}
      </span>
      <span className="tile-value">{value}</span>
      {note && <span className="tile-note">{note}</span>}
    </div>
  );
}

/* ----------------------------------------------------------------- steps */

export type StepState = "pending" | "active" | "done" | "failed";

export function Steps({
  steps,
}: {
  steps: Array<{ label: ReactNode; state: StepState; detail?: ReactNode }>;
}) {
  return (
    <ol className="steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {steps.map((step, index) => (
        <li
          key={index}
          className={`step ${
            step.state === "active"
              ? "step-active"
              : step.state === "done"
                ? "step-done"
                : step.state === "failed"
                  ? "step-failed"
                  : ""
          }`}
        >
          <span className="step-marker">
            {step.state === "done" ? (
              <CheckIcon size={10} />
            ) : step.state === "active" ? (
              <span className="spinner" style={{ width: 9, height: 9 }} />
            ) : step.state === "failed" ? (
              "!"
            ) : (
              ""
            )}
          </span>
          <span>{step.label}</span>
          {step.detail && <span className="step-detail">{step.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

/* ----------------------------------------------------------------- misc */

export function KeyValue({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="kv">
      <span className="kv-key">{k}</span>
      <span className="kv-val">{v}</span>
    </div>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? "Copied" : label}
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
    </IconButton>
  );
}

export function ExplorerLink({
  hash,
  kind = "tx",
  children,
}: {
  hash: string;
  kind?: "tx" | "address";
  children?: ReactNode;
}) {
  return (
    <a
      className="link row"
      style={{ gap: 5, display: "inline-flex", alignItems: "center" }}
      href={`${TARGET_NETWORK.explorer}/${kind}/${hash}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children ?? "View on Etherscan"}
      <ExternalIcon size={12} />
    </a>
  );
}

export function EmptyState({
  glyph,
  title,
  children,
  action,
}: {
  glyph: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-glyph">{glyph}</span>
      <h3>{title}</h3>
      {children && (
        <p className="small muted" style={{ maxWidth: 460 }}>
          {children}
        </p>
      )}
      {action}
    </div>
  );
}
