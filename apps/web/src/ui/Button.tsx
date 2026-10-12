import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";

import { cx } from "./cx.js";

/**
 * The button. Four kinds, and a screen gets ONE primary:
 *
 *   primary    Ember. The thing this screen is for.
 *   secondary  Outlined ink. A real alternative.
 *   ghost      Mist fill. Supporting actions grouped near the primary.
 *   quiet      Underlined text. "Skip for now", "Not now".
 *
 * `asChild` renders the styles onto a child — a Next `<Link>` usually — so a
 * navigation looks like a button and is still a real link.
 */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: "primary" | "secondary" | "ghost" | "quiet";
  readonly size?: "md" | "lg";
  readonly block?: boolean;
  readonly asChild?: boolean;
  /**
   * Pressed and working: a spinner beside the label, and no second press.
   * Not `disabled`, which greys it out and says "you cannot", the opposite of
   * "you did". The spinner waits 120ms, so a quick answer never shows one.
   */
  readonly pending?: boolean;
};

export const Button = ({
  variant = "primary",
  size = "md",
  block = false,
  asChild = false,
  pending = false,
  className,
  type,
  onClick,
  ...rest
}: ButtonProps) => {
  const classes = cx(
    "ui-btn",
    `ui-btn--${variant}`,
    size === "lg" && "ui-btn--lg",
    block && "ui-btn--block",
    className,
  );
  const busy = pending
    ? { "data-pending": "", "aria-busy": true as const }
    : {};
  return asChild ? (
    <Slot className={classes} onClick={onClick} {...busy} {...rest} />
  ) : (
    <button
      type={type ?? "button"}
      className={classes}
      // Pointer events are off while pending; this catches Enter and Space.
      onClick={pending ? (event) => { event.preventDefault(); } : onClick}
      {...busy}
      {...rest}
    />
  );
};

/**
 * A round, icon-only control. `label` is required, because an icon on its own
 * says nothing to a screen reader.
 */
export const IconButton = ({
  label,
  asChild = false,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly label: string;
  readonly asChild?: boolean;
}) => {
  const classes = cx("ui-icon-btn", className);
  return asChild ? (
    <Slot className={classes} aria-label={label} {...rest}>
      {children}
    </Slot>
  ) : (
    <button type="button" className={classes} aria-label={label} {...rest}>
      {children}
    </button>
  );
};
