import Link from "next/link";

import { PRODUCT_LINE, PRODUCT_NAME } from "../src/product.js";
import { Logo } from "../src/ui/index.js";

/** Quiet, and the same everywhere outside the wizard. */
export const SiteFooter = () => (
  <footer className="site-footer">
    <div className="site-footer__inner">
      <div className="site-footer__brand">
        <Logo size={24} />
        <span>
          <strong>{PRODUCT_NAME}</strong> · {PRODUCT_LINE}
        </span>
      </div>
      <nav className="site-footer__links" aria-label="Footer">
        <Link href="/make">Start a film</Link>
        <Link href="/">Your films</Link>
        <Link href="/account">Account</Link>
      </nav>
    </div>
  </footer>
);
