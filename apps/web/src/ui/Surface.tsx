import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./cx.js";
import { Icon, type IconName } from "./Icon.js";

/** A white card on a hairline, lifted a little. `interactive` lifts more on hover. */
export const Card = ({
  interactive = false,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { readonly interactive?: boolean }) => (
  <div className={cx("ui-card", interactive && "ui-card--interactive", className)} {...rest} />
);

/**
 * Coaching: the template's advice for this moment, in Blush. The most valuable
 * words in the product, so they get their own surface rather than grey text.
 */
export const Tip = ({ children, icon = "tip" }: { readonly children: ReactNode; readonly icon?: IconName }) => (
  <div className="ui-tip">
    <Icon name={icon} className="ui-tip__icon" />
    <div className="ui-tip__body">{children}</div>
  </div>
);

/** A small, non-interactive label: an example, a duration, a state. */
export const Chip = ({
  tone = "neutral",
  children,
}: {
  readonly tone?: "neutral" | "accent" | "success" | "warn";
  readonly children: ReactNode;
}) => <span className={cx("ui-chip", `ui-chip--${tone}`)}>{children}</span>;

/** Done, to do, or optional — the mark at the start of every step row. */
export const StatusMark = ({ done }: { readonly done: boolean }) => (
  <span className={cx("ui-mark", done && "ui-mark--done")} aria-hidden="true">
    {done && <Icon name="check" size={14} strokeWidth={2.6} />}
  </span>
);

/** One labelled input. The label is always visible: placeholders are not labels. */
export const TextField = ({
  label,
  hint,
  id,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly id: string;
}) => (
  <div className="ui-field">
    <label htmlFor={id} className="ui-field__label">
      {label}
    </label>
    <input id={id} className={cx("ui-input", className)} {...rest} />
    {hint !== undefined && <p className="ui-field__hint">{hint}</p>}
  </div>
);

/**
 * A message in the page: what happened, and what to do about it. Four tones,
 * each with its own icon so the meaning never rests on colour alone.
 */
export const Notice = ({
  tone = "info",
  title,
  children,
}: {
  readonly tone?: "info" | "success" | "warn" | "error";
  readonly title?: string;
  readonly children?: ReactNode;
}) => {
  const icon: IconName =
    tone === "success" ? "check" : tone === "warn" || tone === "error" ? "alert" : "tip";
  return (
    <div className={cx("ui-notice", `ui-notice--${tone}`)} role={tone === "error" ? "alert" : "status"}>
      <Icon name={icon} size={20} className="ui-notice__icon" />
      <div className="ui-notice__body">
        {title !== undefined && <p className="ui-notice__title">{title}</p>}
        {children !== undefined && <div className="ui-notice__text">{children}</div>}
      </div>
    </div>
  );
};

/** Work is happening and nobody knows how long it will take. */
export const Working = ({ label }: { readonly label: string }) => (
  <div className="ui-working" role="progressbar" aria-label={label} aria-busy="true">
    <span className="ui-working__bar" />
  </div>
);

/** The first letter of an address, in a circle: who is signed in. */
export const Avatar = ({ name, size = 32 }: { readonly name: string; readonly size?: number }) => (
  <span className="ui-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
    {name.trim().charAt(0).toUpperCase() || "?"}
  </span>
);

/** A question that opens to its answer. Native <details>, so it works
 *  without JavaScript and with every screen reader. */
export const Disclosure = ({ summary, children }: { readonly summary: string; readonly children: ReactNode }) => (
  <details className="ui-disclosure">
    <summary className="ui-disclosure__summary">
      <span>{summary}</span>
      <Icon name="plus" size={18} className="ui-disclosure__icon" />
    </summary>
    <div className="ui-disclosure__body">{children}</div>
  </details>
);
