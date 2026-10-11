import Link from "next/link";

import { FAQ, HOW_IT_WORKS, PRODUCT_BLURB, PRODUCT_SUB } from "../src/product.js";
import { authConfigured, currentUser, sessionIdentity } from "../src/server/auth.js";
import { loadWalkthroughView, thumbnailUrl } from "../src/server/capture.js";
import { listProjects, type FilmListing } from "../src/server/project.js";
import { progressOf } from "../src/server/wizard.js";
import {
  Button,
  Card,
  ChapterProgress,
  Chip,
  Disclosure,
  Icon,
  Notice,
  type IconName,
} from "../src/ui/index.js";

/**
 * Films first when there are films; what this is, for anybody who might still
 * need telling.
 *
 * The first version chose between the two on "does this person have films?"
 * and that was wrong in a way only visible on a real browser: pressing Start
 * once, months ago, and abandoning it leaves one "Untitled" row — and from
 * then on the page explaining the product is UNREACHABLE. There is no other
 * route to it. The owner hit exactly that and reasonably concluded nothing
 * had changed.
 *
 * So the list is the answer to "where are my films", and the explanation
 * stays below it for anyone who has not yet proved an address — which is the
 * honest test of "might still be working out what this is". Somebody with an
 * account has decided, and gets their films and nothing else.
 */
export default async function Home() {
  const open = !authConfigured();
  const user = await currentUser();
  const projects = user === null && !open ? [] : await listProjects(user?.id);
  const identity = await sessionIdentity();
  const settled = identity?.email !== null && identity?.email !== undefined;

  if (projects.length === 0) return <Landing open={open} />;

  const posters = new Map<string, string>();
  for (const p of projects) {
    if (p.posterKey !== null) posters.set(p.id, await thumbnailUrl(p.posterKey));
  }
  const resume = projects.find((p) => p.status === "capturing");
  const resumeView = resume === undefined ? null : await loadWalkthroughView(resume.id);

  return (
    <main className="page page--wide home">
      <header className="lib-head">
        <h1 className="display">Your films</h1>
        <Button asChild>
          <Link href="/make">
            <Icon name="plus" size={18} />
            Start a new film
          </Link>
        </Button>
      </header>

      {open && <DevelopmentWarning />}

      {resume !== undefined && resumeView !== null && (
        <ResumeCard film={resume} progress={progressOf(resumeView.steps)} />
      )}

      {!settled && !open && (
        <Notice tone="info" title="Your films are kept in this browser">
          Clearing it, or switching phone, would lose them.{" "}
          <Link href="/signin">Save them to your email</Link> and they are yours anywhere.
        </Notice>
      )}

      <ul className="list lib-grid">
        {projects.map((p) => (
          <li key={p.id}>
            <FilmCard film={p} poster={posters.get(p.id)} />
          </li>
        ))}
      </ul>

      {!settled && <HowItWorks />}
    </main>
  );
}

/** "Pick up where you left off", for the newest film still being made. */
const ResumeCard = ({
  film,
  progress,
}: {
  readonly film: FilmListing;
  readonly progress: ReturnType<typeof progressOf>;
}) => (
  <Card className="lib-resume">
    <div className="lib-resume__text">
      <p className="eyebrow">Pick up where you left off</p>
      <h2 className="title">{film.name === null ? "Your film" : `${film.name}’s film`}</h2>
      <ChapterProgress
        chapters={progress.segments}
        label={`${String(progress.done)} of ${String(progress.total)} done`}
      />
      <p className="muted">
        {progress.done} of {progress.total} done · {progress.timeLeft}
      </p>
    </div>
    <Button size="lg" asChild>
      <Link href={`/projects/${film.id}/continue`}>
        Continue
        <Icon name="forward" size={18} />
      </Link>
    </Button>
  </Card>
);

const FilmCard = ({ film, poster }: { readonly film: FilmListing; readonly poster: string | undefined }) => {
  const state = stateOf(film.status);
  return (
    <Link href={`/projects/${film.id}`} className="film-card">
      <span className="film-card__poster">
        {poster === undefined ? (
          <Icon name="film" size={32} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed thumbnail
          <img src={poster} alt="" loading="lazy" />
        )}
      </span>
      <span className="film-card__body">
        <span className="film-card__name">
          {film.name === null ? "A film not started yet" : `${film.name}’s film`}
        </span>
        <Chip tone={state.tone}>{state.label}</Chip>
      </span>
    </Link>
  );
};

/**
 * The introduction, for somebody who has never seen this.
 *
 * It answers what somebody actually asks before pressing Start — what is it,
 * what will I have to do, what do I get, who can see it — and every answer is
 * true of the product as built. The picture beside the headline is the
 * product itself, drawn with its own components, not a stock photograph of a
 * family that has never used it.
 */
const Landing = ({ open }: { readonly open: boolean }) => (
  <main className="home">
    <section className="hero">
      <div className="hero__inner">
        <div className="hero__copy">
          <h1 className="hero__title">{PRODUCT_BLURB}</h1>
          <p className="hero__sub">{PRODUCT_SUB}</p>
          <div className="row">
            <Button size="lg" asChild>
              <Link href="/make">Start a film</Link>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <Link href="/signin">I have one already</Link>
            </Button>
          </div>
          {/* Said before they start, not after: it decides whether now is a
              good moment. */}
          <ul className="list hero__facts" aria-label="Before you start">
            <li><Icon name="clock" size={18} /> About twenty minutes</li>
            <li><Icon name="user" size={18} /> With the person you are filming</li>
            <li><Icon name="check" size={18} /> No account needed to begin</li>
          </ul>
        </div>
        <ProductPicture />
      </div>
    </section>

    {open && (
      <div className="page page--wide">
        <DevelopmentWarning />
      </div>
    )}

    <div className="page page--wide home__sections">
      <HowItWorks />

      <section className="promises" aria-labelledby="promises-title">
        <h2 id="promises-title" className="display">Made carefully, kept privately</h2>
        <ul className="list promises__grid">
          <Pledge icon="lock" title="Only you can watch it">
            The finished film is kept behind your email address. Nobody else can open it.
          </Pledge>
          <Pledge icon="heart" title="You see it first">
            You watch the first cut before anything is final, and approve it when it is right.
          </Pledge>
          <Pledge icon="check" title="Nothing is ever lost">
            Every recording is kept as you make it. Stop, come back days later, carry on.
          </Pledge>
        </ul>
      </section>

      <section className="faq" aria-labelledby="faq-title">
        <h2 id="faq-title" className="display">Questions</h2>
        <div className="faq__list">
          {FAQ.map((item) => (
            <Disclosure key={item.q} summary={item.q}>
              <p>{item.a}</p>
            </Disclosure>
          ))}
        </div>
      </section>

      <section className="cta">
        <h2 className="display">Ready when you are</h2>
        <p className="lede">Sit down together. It takes about twenty minutes.</p>
        <Button size="lg" asChild>
          <Link href="/make">Start a film</Link>
        </Button>
      </section>
    </div>
  </main>
);

const Pledge = ({
  icon,
  title,
  children,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly children: React.ReactNode;
}) => (
  <li className="promise">
    <span className="promise__icon" aria-hidden>
      <Icon name={icon} size={24} />
    </span>
    <h3 className="heading">{title}</h3>
    <p className="muted">{children}</p>
  </li>
);

/**
 * Shared by both surfaces, so the explanation cannot drift into two versions
 * of itself depending on whether you happen to have a film.
 */
const HowItWorks = () => {
  const icons: readonly IconName[] = ["video", "photo", "play"];
  return (
    <section className="how" aria-labelledby="how-title">
      <h2 id="how-title" className="display">How it works</h2>
      <ol className="list how__grid">
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step.title} className="how__step">
            <span className="how__icon" aria-hidden>
              <Icon name={icons[i] ?? "check"} size={26} />
            </span>
            <span className="how__n">Step {i + 1}</span>
            <h3 className="heading">{step.title}</h3>
            <p className="muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
};

/**
 * One screen of the walk-through, drawn with the real components at a small
 * size. Decorative to a screen reader, which gets the sentence instead.
 */
const ProductPicture = () => (
  <div className="hero__picture" role="img" aria-label="A step of the walk-through: a question, the camera, and a tip">
    <div className="phone" aria-hidden="true">
      <div className="phone__bar">
        <span className="phone__dot" />
        <span className="phone__where">Their story · 5 of 10</span>
        <span className="phone__dot" />
      </div>
      <div className="phone__progress">
        <span style={{ flexGrow: 5 }}><i style={{ width: "100%" }} /></span>
        <span style={{ flexGrow: 10 }}><i style={{ width: "40%" }} /></span>
        <span style={{ flexGrow: 3 }}><i style={{ width: "0%" }} /></span>
        <span style={{ flexGrow: 4 }}><i style={{ width: "0%" }} /></span>
      </div>
      <p className="phone__ask">What is the greatest lesson life has taught you?</p>
      <div className="phone__vf">
        <Icon name="video" size={28} />
      </div>
      <div className="phone__tip">
        <Icon name="tip" size={14} />
        Ask, then say nothing at all.
      </div>
      <div className="phone__record">
        <span className="ui-rec-dot" />
        Record
      </div>
    </div>
  </div>
);

/**
 * Loud on purpose. "Auth quietly turned itself off" is the worst way for this
 * to be wrong, so an unconfigured server says so on the page rather than in a
 * log nobody reads.
 */
const DevelopmentWarning = () => (
  <Notice tone="warn" title="Development only">
    No sign-in is configured on this server, so every film here is open to anyone who can
    reach it.
  </Notice>
);

/**
 * The state of a film, in words rather than in the enum's, with a colour that
 * says whether it needs them.
 *
 * `awaiting_approval` and `processing` are the pipeline's vocabulary. They
 * also read as more final than they are — "failed" beside somebody's
 * grandmother's name, with no hint that every recording is safe, is a worse
 * sentence than anything the project page says about the same row.
 */
const stateOf = (
  status: string,
): { readonly label: string; readonly tone: "neutral" | "accent" | "success" | "warn" } =>
  ({
    draft: { label: "Not started", tone: "neutral" as const },
    capturing: { label: "In progress", tone: "neutral" as const },
    processing: { label: "Being put together", tone: "neutral" as const },
    awaiting_approval: { label: "Ready to watch", tone: "accent" as const },
    approved: { label: "Being made", tone: "neutral" as const },
    rendering: { label: "Being made", tone: "neutral" as const },
    delivered: { label: "Ready", tone: "success" as const },
    failed: { label: "Needs another go", tone: "warn" as const },
  })[status] ?? { label: status, tone: "neutral" as const };
