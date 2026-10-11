"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { Icon } from "./Icon.js";

/**
 * A sheet: slides up from the bottom on a phone, in from the right on a wide
 * screen. Radix supplies everything that is easy to get wrong — focus moves in
 * and is trapped, Escape closes, focus returns to the trigger, the page behind
 * is inert to a screen reader.
 */
export const Sheet = ({
  trigger,
  title,
  description,
  children,
  footer,
}: {
  /** The control that opens it. Must be a single element that accepts a ref. */
  readonly trigger: ReactNode;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) => (
  <Dialog.Root>
    <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="ui-sheet__overlay" />
      <Dialog.Content className="ui-sheet" aria-describedby={description === undefined ? undefined : "ui-sheet-desc"}>
        <header className="ui-sheet__head">
          <div>
            <Dialog.Title className="ui-sheet__title">{title}</Dialog.Title>
            {description !== undefined && (
              <Dialog.Description id="ui-sheet-desc" className="ui-sheet__desc">
                {description}
              </Dialog.Description>
            )}
          </div>
          <Dialog.Close className="ui-icon-btn" aria-label="Close">
            <Icon name="close" size={18} />
          </Dialog.Close>
        </header>
        <div className="ui-sheet__body">{children}</div>
        {footer !== undefined && <footer className="ui-sheet__foot">{footer}</footer>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);

/** Wraps a link inside a sheet so following it also closes the sheet. */
export const SheetClose = Dialog.Close;
