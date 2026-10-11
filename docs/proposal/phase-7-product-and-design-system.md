# Phase 7 — Make it a product: design system, wizard, and a door that locks

**Status: proposed 2026-10-11, waiting on the owner's brand pick and approval.**

## What was asked

> It's time to start packaging this up as a product and really revamping the
> UI and UX. We should conform to a design system and I need the standard to
> be as good as Airbnb. … I have a film ready to watch even though I'm not
> logged in. … When we create a film I'm just scrolling down a page — it
> should be a step-by-step onboarding wizard instead.

Four decisions were taken on 2026-10-11, before anything was designed:

| Question | Decision |
|---|---|
| Flow shape | **Wizard + overview.** One full-screen step at a time, with an "All steps" sheet always one tap away. |
| Accounts | **Save at "Make my film".** Capture stays anonymous. Rendering needs a confirmed address; watching and downloading need a signed-in, non-anonymous account. |
| Design system | **Our own tokens and components, on Radix primitives**, documented on a living style-guide page. No Tailwind, no shadcn. |
| Brand | **Three directions proposed as mockups** (Porch, Told, Kin) for the owner to pick before Block 2. |

The wizard **replaces the hub as the default path but keeps what the hub was
for.** In August the owner rejected seventeen numbered pages and asked for
three felt things: reassurance after each take, honest time remaining, and
never feeling trapped. The wizard answers all three: a "Got it" beat after
every take, minutes left on every screen, and an overview, skip and
save-and-leave on every screen. What changes is that the product now leads by
default instead of asking people to choose an order from a list.

## Why the film was watchable without logging in

It was not a leak in the usual sense. It is the model built in Phase 3b:
pressing Start signs the browser in **anonymously**, and that anonymous
identity owns the film from the first press. `guardProject` accepts any
owner, anonymous or not, so the hub, the preview, `/delivery`, `/download` and
`/api/media` all open for whoever is holding that browser. The header's "Kept
in this browser" says this, but quietly.

What it means in practice: a shared or family computer, or anyone who later
picks up the phone, gets the finished film with no sign-in. It also means
there is no address to tell when the film is ready, so email delivery could
never have worked for these films.

### The rule from now on

```
capturing            anonymous OK       (start with no friction)
press "Make my film" ─► needs a confirmed address  ─► the save sheet
processing … delivered   owner must be signed in AND not anonymous
```

- **`makeFilm` refuses an anonymous owner** and returns `needs-account`. The
  button then opens the save sheet (email, or email + password), which reuses
  the two doors from Phase 4 unchanged: `updateUser({ email })` on the
  anonymous session keeps the auth id, so nothing is adopted and nothing is
  orphaned.
- **Clicking the link submits the film.** The intent travels with the link
  (`/auth/callback?next=/projects/<id>&then=make`), so the person lands on
  "We're making your film" rather than on a button they have to press again.
- **`guardProject` gains a stage-aware mode.** Once a project leaves
  `capturing`, an anonymous holder sees the save sheet in place of the film:
  not a 404, because it is their film. `delivery`, `download` and
  `api/media` (for anything that isn't a capture thumbnail) refuse an
  anonymous holder outright.
- **Films already past capture and still owned anonymously** get the same
  save sheet the next time they are opened. Nothing is deleted or moved.

The cost: **custom SMTP becomes a launch blocker, not a nice-to-have.** Every
film now goes through a confirmation email, and the built-in Supabase sender
allows about two an hour. Locally, Mailpit at :54324 covers it.

## The design system

### Where it lives

`packages/ui`, a new workspace package, consumed by `apps/web`:

```
packages/ui/
  src/tokens.css        every colour, type step, space, radius, shadow, motion
  src/tokens.ts         the same values for TypeScript (render can use them later)
  src/components/       Button, IconButton, Card, Sheet, Dialog, Progress,
                        ChapterProgress, Field, TextField, Toast, Badge,
                        StepCard, Viewfinder, RecordButton, MediaTile,
                        EmptyState, Skeleton, Spinner, VisuallyHidden
  src/icons/            one stroke set, 24px grid, 1.75 stroke
```

- **Radix primitives** (`@radix-ui/react-dialog`, `-progress`, `-toast`,
  `-visually-hidden`, `-slot`) give focus trapping, escape handling and screen
  reader semantics. We own every pixel on top of them.
- **CSS modules over the tokens.** `globals.css` was a step towards this in #19
  and its custom properties move into `tokens.css` almost unchanged. They are
  renamed into semantic layers (`--color-surface`, `--color-action`,
  `--color-text-muted`) so swapping the brand is a token change, not a hunt.
- **`/design`, a living style guide** in the web app: every token and every
  component in every state, rendered by the real code. It is the review
  surface for each block and is excluded from search engines.
- **Still true:** `apps/web` contains no string that only makes sense for
  life-advice. Chapter intros, coaching, examples and time estimates stay in
  `@film/templates`.

### What "as good as Airbnb" means here, concretely

A bar is only useful if it can be checked, so this is the checklist every
screen is reviewed against:

1. **One primary action per screen**, visually unmistakable, reachable by a
   thumb (bottom of the screen on a phone).
2. **Type does the hierarchy**: one heading size per screen, body at
   16–17px, nothing grey that fails 4.5:1.
3. **An 8px spacing rhythm, no exceptions.** Radii and shadows come from
   tokens only.
4. **Every state is designed**: empty, loading (skeletons, not spinners,
   where the shape is known), error, offline, permission-denied camera, slow
   upload, and success.
5. **Motion explains rather than decorates**: 150–250ms, ease-out,
   reduced-motion respected. A step slides forward and the take review fades
   up, and that is all.
6. **Mobile first at 375px**, then 768 and 1280. No horizontal scroll, ever.
7. **Accessible by construction**: 44px targets, visible focus, real
   buttons, labelled icon buttons, captions on the example film.
8. **Copy is calm and specific.** No exclamation marks, no "Oops", and an
   error always says what to do next.

## The screens

Every screen is redrawn. The list, in the order a customer meets them:

| Screen | What changes |
|---|---|
| **Home, signed out** | A photo-led hero with an example film playing muted, "how it works" in three illustrated steps, what you'll need, FAQ, a footer. |
| **Home, signed in** | "Your films": a grid of poster frames with status chips (In progress · Making · Ready), and "Continue" on the most recent unfinished film. |
| **Choose a film** (`/make`) | A gallery of template cards (poster, length, time to make, what you'll need), built for N templates even while there is one. A detail sheet before Start. |
| **Chapter intro** | New. One screen per chapter: what's coming, how long it takes, what to set up ("somewhere quiet, landscape, near a window"). Copy comes from the template. |
| **Detail step** | One question per screen with a large input, keyboard-aware, Enter to continue. |
| **Question step** | The mockup: the question, a viewfinder, coaching tip, Record, plus Upload instead and Skip for now. Landscape nudge. |
| **Take review** | New as a screen: plays the take back, with "Got it" reassurance, length feedback (`qcNoteOf`), Keep (auto-advances) and Retake. |
| **Photo / video step** | The ask, examples as chips, camera or library, crop preview. |
| **All steps sheet** | The old hub, as a bottom sheet: chapters, every step with done/skipped/to-do, tap to jump. |
| **Save and leave** | The close button saves, explains that everything is kept, and offers a link by email to continue on another device. |
| **Review before making** | The hub's last job: everything at a glance, required gaps called out, and the Make my film button. |
| **Save sheet** | New: email (+ optional password), then "Check your email". The gate above. |
| **Making your film** | Progress made honest: stages named in human words, "we'll email you", safe to close. |
| **Preview and approve** | The player is the hero, Approve is the primary action, "Request a change" is secondary. |
| **Ready** | Download, share link (later), "Make another". |
| **Sign in / account / password** | Rebuilt on the system, with the same two doors and logic as Phase 4. |
| **Failure, 404, offline** | Designed states, never the framework default. |

### Mechanics of the wizard

- **A URL per step stays** (`/projects/[id]/step/[stepId]`), so the browser's
  Back works, a reload lands in the same place, and another device resumes
  where you were. Everything is still derived from rows; there is no wizard
  state in React that a reload could lose.
- **Next is computed, not stored**: the first step after this one, in template
  order, that isn't done. Skipped required steps are collected on the review
  screen ("Two things still to do").
- **The take review is the reassurance beat.** Keep auto-advances to the next
  step after the upload is acknowledged, and an upload still running continues
  in the background with its progress shown in the top bar.
- **Templates gain two optional fields per chapter**: `intro` (heading and
  body) and `prepare` (a short list of what to set up). Additive, versioned and
  data-only, so no template-specific code.

## Blocks

Each block ends in a PR and a stop, with a commit per part, as before.

| # | Block | Depends on |
|---|---|---|
| 1 | **The door locks.** The gate at Make my film, the stage-aware `guardProject`, refusing anonymous holders on delivery/download/media, auto-submit after the link, and tests. Built on the current styling. | nothing |
| 2 | **Design system foundation.** `packages/ui`, tokens from the chosen brand, the core components, `/design`. No screen changes yet. | brand pick |
| 3 | **The wizard.** Chapter intros, step screens, take review, All steps sheet, save and leave, review before making. | 2 |
| 4 | **Front door.** Home (both states), the template gallery, Your films. | 2 |
| 5 | **After capture.** Making, preview and approve, ready, failure. | 2 |
| 6 | **Accounts on the system.** Sign in, the save sheet's final form, password, account. | 1, 2 |
| 7 | **Polish and proof.** Motion, every empty and error state, an accessibility audit, a real iPhone in Safari end to end, golden screenshots of each screen. | 3–6 |

Block 1 goes first because it fixes what the owner noticed, and it needs no
brand.

## Owed by the owner

- **Pick a brand direction**, or mix them: the mockups are three artboards side
  by side. The name needs a trademark and domain check before it is real.
- **An example film to show on the home page**, with the subject's consent.
  Nothing on the landing page works as well as the product itself.
- **SMTP provider and sending domain.** This is now on the critical path
  (see above).
- Unchanged from before: licensed music, and a read of the coaching copy.
