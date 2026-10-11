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
