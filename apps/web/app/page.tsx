import Link from "next/link";

import { HOW_IT_WORKS, PRODUCT_BLURB, PRODUCT_SUB } from "../src/product.js";
import { authConfigured, currentUser } from "../src/server/auth.js";
import { listProjects } from "../src/server/project.js";

/**
 * Two pages at one address, and which one you get is the honest question
 * "does this person have films here?"
 *
 * Somebody arriving with nothing needs to know what this is and what they are
 * agreeing to before they press anything. Somebody with films in progress
 * needs those films, immediately, and nothing else — telling them again what
 * the product does would be noise on the screen they see most.
 */
export default async function Home() {
  const open = !authConfigured();
  const user = await currentUser();
  const projects = user === null && !open ? [] : await listProjects(user?.id);

  if (projects.length === 0) return <Introduction open={open} />;

  return (
    <main className="page stack-5">
      <h1 className="title">Your films</h1>

      {open && <DevelopmentWarning />}

      <ul className="list">
        {projects.map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}`} className="card film-row">
              <span className="film-row__name">{p.subjectName ?? "Untitled"}</span>
              <span className="muted">{worded(p.status)}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="row">
        <Link href="/make" className="btn btn--secondary">
          Start another
        </Link>
      </div>
    </main>
  );
}

/**
 * What this is, for somebody who has never seen it.
 *
 * Deliberately not a landing page: no pricing, no testimonials, no example
 * film. It answers the three questions somebody actually has — what is it,
 * what will I have to do, what do I get — and then gets out of the way. The
 * one thing it must not do is let somebody press Start without knowing they
 * will need the person in front of them.
 */
const Introduction = ({ open }: { readonly open: boolean }) => (
  <main className="page stack-6">
    <section className="stack-4">
      <h1 className="display">{PRODUCT_BLURB}</h1>
      <p className="lede">{PRODUCT_SUB}</p>
      <div className="row">
        <Link href="/make" className="btn btn--primary">
          Start a film
        </Link>
        <Link href="/signin" className="btn btn--secondary">
          I have one already
        </Link>
      </div>
      {/* Said before they start, not after: it is the one thing that decides
          whether now is a good moment. */}
      <p className="tiny">
        About twenty minutes, with the person you are filming. No account needed
        to begin.
      </p>
    </section>

    {open && <DevelopmentWarning />}

    <section className="stack-4">
      <h2 className="eyebrow">How it works</h2>
      <ol className="list steps">
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step.title} className="card step">
            <span className="step__number" aria-hidden>
              {i + 1}
            </span>
            <span className="step__text">
              <span className="heading">{step.title}</span>
              <span className="lede">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  </main>
);

/**
 * Loud on purpose. "Auth quietly turned itself off" is the worst way for this
 * to be wrong, so an unconfigured server says so on the page rather than in a
 * log nobody reads.
 */
const DevelopmentWarning = () => (
  <p className="note note--warn">
    No sign-in is configured on this server, so every film here is open to
    anyone who can reach it. Development only.
  </p>
);

/**
 * The state of a film, in words rather than in the enum's.
 *
 * `awaiting_approval` and `processing` are the pipeline's vocabulary, printed
 * straight onto the one page a customer sees most. They also read as more
 * final than they are — "failed" beside somebody's grandmother's name, with no
 * hint that every recording is safe, is a worse sentence than anything the
 * project page says about the same row.
 */
const worded = (status: string): string =>
  ({
    draft: "not started",
    capturing: "still adding to it",
    processing: "being put together",
    awaiting_approval: "ready for you to watch",
    approved: "being made",
    rendering: "being made",
    delivered: "ready",
    failed: "needs another go",
  })[status] ?? status;
