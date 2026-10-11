import type { SVGProps } from "react";

/**
 * One stroke icon set: 24px grid, 1.8 stroke, round caps. Drawn here rather
 * than pulled from a package so there is exactly one visual voice, and so an
 * icon costs nothing to ship.
 *
 * Always decorative: an icon never carries meaning on its own. A control that
 * is only an icon gets its words from `aria-label` on the control.
 */
const PATHS = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 5l-7 7 7 7" />,
  forward: <path d="M9 5l7 7-7 7" />,
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  camera: (
    <>
      <path d="M4 8.5A2.5 2.5 0 016.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0120 8.5v8a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 16.5z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="M16 10.5l5-3v9l-5-3" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 15l-5-5-8 9" />
    </>
  ),
  upload: <path d="M12 16V4M7 9l5-5 5 5M5 15v2.5A2.5 2.5 0 007.5 20h9a2.5 2.5 0 002.5-2.5V15" />,
  text: <path d="M5 7V5h14v2M12 5v14M9 19h6" />,
  tip: <path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0012 3z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  rotate: <path d="M4 12a8 8 0 0113.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 01-13.7 5.6L4 15.5M4 20v-4.5h4.5" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 018 0v2.5" />
    </>
  ),
  home: <path d="M4 10.5L12 4l8 6.5V19a1 1 0 01-1 1h-4.5v-5.5h-5V20H5a1 1 0 01-1-1z" />,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
} as const;

export type IconName = keyof typeof PATHS;

export const Icon = ({
  name,
  size = 20,
  ...rest
}: { readonly name: IconName; readonly size?: number } & SVGProps<SVGSVGElement>) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {PATHS[name]}
  </svg>
);

/** The Porch mark: a screen with a play triangle, in Ember. */
export const Logo = ({ size = 28 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" focusable="false">
    <rect x="2" y="8" width="32" height="22" rx="7" fill="none" stroke="var(--accent)" strokeWidth="3" />
    <path d="M15 14.5v9l7.5-4.5z" fill="var(--accent)" />
  </svg>
);
