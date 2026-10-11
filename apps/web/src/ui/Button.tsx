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
};

export const Button = ({
  variant = "primary",
  size = "md",
  block = false,
  asChild = false,
  className,
  type,
  ...rest
}: ButtonProps) => {
  const classes = cx(
    "ui-btn",
    `ui-btn--${variant}`,
    size === "lg" && "ui-btn--lg",
    block && "ui-btn--block",
    className,
  );
  return asChild ? (
    <Slot className={classes} {...rest} />
  ) : (
    <button type={type ?? "button"} className={classes} {...rest} />
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
