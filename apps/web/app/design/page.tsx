import {
  Button,
  Card,
  ChapterProgress,
  Chip,
  Icon,
  IconButton,
  Logo,
  Sheet,
  StatusMark,
  TextField,
  Tip,
  type IconName,
} from "../../src/ui/index.js";
import { PRODUCT_LINE, PRODUCT_NAME } from "../../src/product.js";
import { FittedAnswers } from "../projects/[id]/FittedAnswers.js";

/**
 * The living style guide: every token and every component, rendered by the
 * code the product uses. It is the review surface for design changes — if it
 * looks wrong here, it looks wrong everywhere — and the place to check a new
 * component before a screen depends on it.
 *
 * Kept out of search engines; there is nothing private on it.
 */
export const metadata = { title: "Design system", robots: { index: false } };

const SWATCHES: readonly { name: string; token: string; hex: string; use: string }[] = [
  { name: "Ember", token: "--accent", hex: "#D92B4B", use: "The one primary action per screen" },
  { name: "Ember deep", token: "--accent-hover", hex: "#B01F3B", use: "Hover, and text on Blush" },
  { name: "Ink", token: "--ink", hex: "#222222", use: "Text, outlines, focus" },
  { name: "Stone", token: "--ink-3", hex: "#6A6A6A", use: "Secondary text — the lightest grey allowed for words" },
  { name: "Mist", token: "--surface-2", hex: "#F7F7F7", use: "Quiet fills, ghost buttons" },
  { name: "Blush", token: "--accent-soft", hex: "#FFF4F1", use: "Coaching tips, gentle highlights" },
  { name: "Success", token: "--success", hex: "#00805A", use: "Done, saved" },
  { name: "Danger", token: "--danger", hex: "#B3261E", use: "Errors — never Ember" },
];

const TYPE: readonly { name: string; className: string; spec: string }[] = [
  { name: "Display", className: "display", spec: "28–36 / 800 / −3%" },
  { name: "Title", className: "title", spec: "26 / 700 / −2%" },
  { name: "Heading", className: "heading", spec: "18 / 700" },
  { name: "Body", className: "lede", spec: "16 / 400 / 1.55" },
  { name: "Small", className: "muted", spec: "14 / 400" },
  { name: "Eyebrow", className: "eyebrow", spec: "12 / 700 / +8% caps" },
];

const ICONS: readonly IconName[] = [
  "close", "back", "forward", "list", "check", "camera", "video", "photo",
  "upload", "text", "tip", "clock", "rotate", "lock", "home", "play",
];

export default function DesignPage() {
  return (
    <main className="ds">
      <header className="ds__head">
        <div className="ds__brand">
          <Logo size={44} />
          <h1 className="ds__name">{PRODUCT_NAME} design system</h1>
        </div>
        <p className="lede">{PRODUCT_LINE}</p>
        <p className="muted">
          The Porch design system. Tokens in <code>app/globals.css</code>, components in{" "}
          <code>src/ui</code>. Every screen is built from what is on this page.
        </p>
      </header>

      <Section title="Colour">
        <div className="ds__swatches">
          {SWATCHES.map((s) => (
            <div key={s.token} className="ds__swatch">
              <span className="ds__chip" style={{ background: `var(${s.token})` }} />
              <strong>{s.name}</strong>
              <code>{s.hex}</code>
              <span className="muted">{s.use}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type — Plus Jakarta Sans">
        <div className="stack-4">
          {TYPE.map((t) => (
            <div key={t.name} className="ds__type">
              <span className="tiny">{t.name} · {t.spec}</span>
              <span className={t.className}>What is the greatest lesson life has taught you?</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="row">
          <Button>Make my film</Button>
          <Button variant="secondary">See an example</Button>
          <Button variant="ghost">Upload instead</Button>
          <Button variant="quiet">Skip for now</Button>
          <Button disabled>Not yet</Button>
        </div>
        <div className="row">
          <Button size="lg">
            <span className="ui-rec-dot" aria-hidden />
            Record answer
          </Button>
          <IconButton label="Close"><Icon name="close" size={18} /></IconButton>
          <IconButton label="Back"><Icon name="back" size={18} /></IconButton>
        </div>
      </Section>

      <Section title="Surfaces">
        <div className="ds__grid">
          <Card>
            <p className="heading">A card</p>
            <p className="muted">Hairline, 16px radius, a little lift.</p>
          </Card>
          <Card interactive>
            <p className="heading">An interactive card</p>
            <p className="muted">Lifts further on hover.</p>
          </Card>
        </div>
        <Tip>
          The most important answer in the film — it opens it and it closes it. Ask, then say
          nothing at all.
        </Tip>
        <div className="row">
          <Chip>A wedding photo</Chip>
          <Chip tone="accent">To do</Chip>
          <Chip tone="success"><Icon name="check" size={14} /> Saved</Chip>
          <Chip tone="warn">A little quiet</Chip>
          <StatusMark done={false} />
          <StatusMark done />
        </div>
      </Section>

      <Section title="Fields">
        <div className="ds__narrow">
          <TextField id="ds-email" label="Email address" type="email" placeholder="you@example.com" hint="We only use it to send you the film." />
        </div>
      </Section>

      <Section title="Progress">
        <ChapterProgress
          label="9 of 22 done"
          chapters={[
            { id: "a", title: "The film", total: 5, done: 5 },
            { id: "b", title: "Their story", total: 10, done: 4, current: true },
            { id: "c", title: "Photographs", total: 3, done: 0 },
            { id: "d", title: "Moments", total: 4, done: 0 },
          ]}
        />
      </Section>

      <Section title="Sheet">
        <Sheet
          title="All steps"
          description="9 of 22 done · about 14 minutes left"
          trigger={<Button variant="secondary">Open a sheet</Button>}
          footer={<Button block variant="ghost">Save and leave</Button>}
        >
          <p className="lede">Slides up on a phone and in from the right on a wide screen. Focus is trapped inside and Escape closes it.</p>
        </Sheet>
      </Section>

      <Section title="How the answers were fitted">
        <FittedAnswers
          fitted={[
            {
              questionId: "love_lesson",
              label: "What have you learned about love?",
              usedMs: 21_600,
              spokenMs: 82_300,
              leftOut: [
                "Um, you know, I mean, like, it was.",
                "But the city taught me how to work hard. Every job I ever had, I gave it everything.",
              ],
            },
            {
              questionId: "identity_name",
              label: "What is your name?",
              usedMs: 3_400,
              spokenMs: 12_100,
              leftOut: ["And everyone calls me Nan, which I have always liked."],
            },
          ]}
        />
      </Section>

      <Section title="Icons">
        <div className="ds__icons">
          {ICONS.map((name) => (
            <span key={name} className="ds__icon">
              <Icon name={name} size={24} />
              <span className="tiny">{name}</span>
            </span>
          ))}
        </div>
      </Section>
    </main>
  );
}

const Section = ({ title, children }: { readonly title: string; readonly children: React.ReactNode }) => (
  <section className="ds__section">
    <h2 className="eyebrow">{title}</h2>
    <div className="stack-5">{children}</div>
  </section>
);
