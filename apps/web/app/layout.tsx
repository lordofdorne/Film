import "./globals.css";
import "../src/ui/ui.css";
import "./styles/after-capture.css";
import "./styles/accounts.css";

import { Plus_Jakarta_Sans } from "next/font/google";

import { PRODUCT_NAME, PRODUCT_SUB } from "../src/product.js";
import { NavProgress } from "./NavProgress.js";
import { OutsideTheWizard } from "./OutsideTheWizard.js";
import { SiteFooter } from "./SiteFooter.js";
import { SiteHeader } from "./SiteHeader.js";

/**
 * Porch's one typeface, self-hosted by Next at build time: no request to a
 * font service from somebody's phone, and no flash of a fallback face.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

/**
 * The tab used to say "Life Advice — preview", which is the name of a template
 * and the name of a development stage. Neither is a product.
 */
export const metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: PRODUCT_SUB,
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // The ground is white now, so the phone's status bar is too.
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>
        <NavProgress />
        {/* First thing a keyboard reaches: straight past the header. */}
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        <div className="shell">
          {/* The capture wizard is full screen: its own top bar replaces this. */}
          <OutsideTheWizard>
            <SiteHeader />
          </OutsideTheWizard>
          <div id="content" tabIndex={-1} className="shell__content">
            {children}
          </div>
          <OutsideTheWizard>
            <SiteFooter />
          </OutsideTheWizard>
        </div>
      </body>
    </html>
  );
}
