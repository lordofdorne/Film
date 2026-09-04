import "./globals.css";

import { PRODUCT_NAME, PRODUCT_SUB } from "../src/product.js";
import { SiteHeader } from "./SiteHeader.js";

/**
 * The tab used to say "Life Advice — preview", which is the name of a template
 * and the name of a development stage. Neither is a product.
 */
export const metadata = {
  title: PRODUCT_NAME,
  description: PRODUCT_SUB,
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  /**
   * A pale ground rather than the browser's white, so the phone's status bar
   * matches the page instead of sitting on a seam.
   */
  themeColor: "#fbfbfa",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <SiteHeader />
          {children}
        </div>
      </body>
    </html>
  );
}
