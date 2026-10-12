# Phase 8 — Fluid: two audits and the upgrades they point to

**Status: audited 2026-10-11; approved 2026-10-12. Block 1 built (see "Block 1, as built" at the end). Block 2 built: one camera, background uploads, bounded takes. Block 4 built: render while they watch, three frames at a time.**

## What was asked

> The overall recording and editing is choppy. This should be more fluid and
> performant. Navigating the whole site is choppy and slow. We need two
> audits/upgrades: one focusing on the recording and editing, and one focusing
> on moving through the site.

Everything below was measured on this machine on 2026-10-11, against the dev
server the owner uses (`pnpm web`) **and** a production build (`next build &&
next start`) of the same commit, both talking to the local Postgres and the
local Supabase auth server. Numbers are from a headless Chrome at phone width
driving the real flow, and from `curl` with a real session cookie.

---

## Audit A — moving through the site

### What a tap costs today

| Tap | Dev server | Production build |
|---|---|---|
| Start this film → chapter intro | 887 ms | 2,426 ms |
| Begin → first step | 474 ms | 1,803 ms |
| Skip for now (step → step), five taps | 290–662 ms | 380–1,145 ms |
| Open the overview | 871 ms (1.5 s to settle) | 678–1,010 ms (2.7 s to settle) |
| Home, with films | 588 ms (1.2 s to settle) | 1,079–1,435 ms (2.9 s to settle) |
| Browser Back | 6 ms | 15 ms |

Two things stand out. **Production is not faster than dev**, so this is not
dev-mode compilation. And during every one of those taps **the screen does not
change at all**: no pressed state, no skeleton, nothing, until the whole next
page arrives.

### Why

**1. Every signed-in request asks the auth server who you are, two or three
times, and each ask costs 200–535 ms.** (The cause of most of it.)

Measured directly: `GET /auth/v1/user` with a real session token answers in
**200–535 ms**; with no session it answers in 5 ms. A signed-in 404 page takes
260–520 ms; a signed-out one takes 10 ms. The page does nothing else.

One wizard step pays it repeatedly, in sequence:

| Where | Call |
|---|---|
| `middleware.ts` | `getUser()`, on every request, prefetches included |
| `guardProject` → `currentUser` | `getUser()` again |
| `sessionIdentity` (project page, home, account) | `getUser()` a third time |

On hosted Supabase each of these also crosses the internet, so production will
be the same or worse. Prefetching makes it heavier, not lighter: a production
walk through six steps made 26 page requests, each paying the middleware's call.

**The fix is already supported.** Our tokens are signed with ES256 (checked: the
token header says `"alg":"ES256"` and the JWKS is published), so
`auth.getClaims()` verifies them **locally** against the cached public key, in
microseconds, with no network call. This is what Supabase now recommends for
both middleware and server code. Claims carry `sub`, `email` and
`is_anonymous`, which is everything `guardProject` needs. Only the pending
address (`new_email`) is missing, and only the save sheet and the account page
need it, so those two keep one `getUser()`.

The trade-off, stated plainly: a revoked session keeps working until its token
expires (at most an hour, `jwt_expiry = 3600`). Signing out clears the cookie,
so this only matters for a stolen token, and Supabase considers it the standard
posture.

**2. ~~No `loading.tsx` anywhere, so dynamic pages are never really prefetched
and every tap freezes the screen.~~** *Corrected 2026-10-12: wrong.* This was
inferred from the dev server, which never prefetches. On a production build
the default prefetch does fetch the next step, and Skip on `main` already
measured 26–31 ms. What was slow was every tap that reached the server, for
reason 1. And adding loading screens made things worse, not better: see
"Block 1, as built".

**3. The wizard frame is torn down and rebuilt on every step.** `WizardFrame`
is rendered by each page rather than by a layout, so the bar, the progress and
the All steps sheet re-mount on every tap. The same frame in
`projects/[id]/layout.tsx` stays put; only the middle changes. This is also
what lets the camera survive between steps (Audit B).

**4. Smaller, but real:**
- The film page ships the 102 KB video player even when it is only the capture
  overview, because `PreviewClient` is imported statically. 224 KB first load
  against ~120 KB everywhere else.
- Home signs poster URLs one at a time in a loop, and loads the resume card's
  walk-through after the list rather than alongside it.
- No transition between steps. Part 7 planned "a step slides forward"; with
  the frame in a layout this is a 200 ms CSS animation on the middle only.

### What it should cost after

| Tap | Target |
|---|---|
| Anything inside the wizard | **Under 100 ms to visible change** (the shell, from prefetch), under 300 ms to full content |
| Overview, home | Shell instantly, content under 400 ms in production |
| Server time per signed-in page | Under 50 ms locally, with zero auth-server calls on ordinary pages |

---

## Audit B — recording and the preview ("editing")

### Recording: what happens today, step by step

1. **Press Record** → the browser opens the camera *now* (`getUserMedia`), which
   takes half a second to two seconds, during which nothing is on screen. Then
   recording starts immediately. There is **no live view before recording**,
   so nobody can frame the shot before it counts.
2. **Stop** → the camera is switched off, the take is shown back, the upload
   starts.
3. **Keep and continue is disabled** until three things finish in sequence: a
   server action to get an upload URL, the upload itself, and a second server
   action to record it, **followed by `router.refresh()`**, a full re-render of
   the page. Each server action also pays Audit A's auth cost twice. On a phone
   connection with a long take this is minutes of waiting on one screen.
4. **Next step** → the page is replaced, the component unmounts, the camera
   is switched off. **Press Record again → the camera starts from cold
   again**, and on some phones Safari asks for permission again.

That is the choppiness: every question is cold start, record, stop, wait, cold
start.

Also found:
- **No bitrate is set on `MediaRecorder`.** File size is left to the browser;
  Safari's mp4 at 1080p is large. Uploads take longer than they need to, and
  the full take is held in memory until Stop because `start()` has no
  timeslice.
- The recording timer and every upload-progress event re-render the whole step
  component. Cheap today, but it is the same component that holds the live
  `<video>`.

### The preview: why playback stutters

The preview is the real composition in Remotion's Player. Two things make it
choppy:

1. **Every clip starts loading at the moment it is due to play.** Sequences
   mount at their first frame, so each cut creates a fresh `<video>`, opens a
   new connection to R2, and seeks into the file **while the film is meant to
   be playing**. Remotion has `premountFor` (load it a second or two early,
   hidden) and `pauseWhenBuffering` (hold cleanly rather than stutter and drift
   out of sync); both are in the installed 4.0.505 and neither is used.
2. **It streams the full-quality files.** Each interview piece is fetched
   **twice** (once as silent picture, once as sound) at 1080p, CRF 20, from
   R2. Ingest uses x264's default keyframe spacing (about every 10 seconds), so
   every jump into a clip decodes up to ten seconds of video before the first
   frame. Photographs go to the player at full phone resolution, several MB
   each, and the Player waits for each one to load.

And one that is not choppiness but will be noticed: media URLs on the preview
are signed for **15 minutes**. Watch the cut, read the notes, come back after
lunch: playback fails part-way.

### Making the finished film (added 2026-10-12)

The owner's rule for this part: **no compromise on quality**. "Check back
later, your film is being made" is fine; a worse film is not. So every change
below must produce the same delivered file, and the benchmark proves it by
checksum.

**Where the 6.5 minutes goes** (a real 3-minute film, 5,481 frames at
1440×1080, from the render's own log on this 10-core Mac):

| Phase | Time |
|---|---|
| Pull 18 assets, bundle | ~7 s |
| Draw frames, **one browser tab at a time** (`concurrency: 1`) | ~313 s (17 fps) |
| x264 `slow` catching up, audio mix, two loudness checks | ~70 s |
| **Total** | **~389 s** |

**Benchmark** (30 s of the same film, crf 21 / `slow` unchanged, picture
compared by MD5 of every decoded frame):

| Tabs | Frames drawn | File finished | Decoded picture |
|---|---|---|---|
| 1 (today) | 53 s | 66 s | `052cbfb2…` |
| 2 | 31 s | 44 s | identical |
| **3** | **24 s** | **37 s** | identical |
| 4 | 22 s | 48 s | identical |
| 5 | 22 s | 55 s | identical |
| 8 | 34 s | 66 s | identical |

The whole film at 3 tabs: frames in **168 s** (from 313), file in **225 s**.
The picture is bit-for-bit the same at every setting, as it should be:
Remotion renders each frame independently.

Past three tabs it gets *slower*: the tabs take the cores the `slow` encoder
needs, and the encoder becomes the bottleneck (the tail after the last frame is
there with sound switched off too). A faster preset would remove that tail at
the same visual quality but a **larger download**. That was traded the other
way on purpose in August (110 MB → 76 MB), so it stays as it is.

**The bigger win is when the render starts, not how fast it runs.** Today the
render is queued when the customer presses Approve, so they wait the full
render after deciding. The dispatcher already keeps *render* and *deliver*
apart, and only *deliver* checks for an approval. So the delivery render can
start the moment the first cut is composed, **while they are watching the
preview**. A 3-minute film plus reading the notes is about as long as the
render. Approve the cut they were shown, and the film is ready within seconds;
it is the same edit version, so the same file. The cost is a wasted render when
somebody doesn't approve that cut, which, until "request a change" exists,
only happens when they abandon the film.

Smaller and also output-neutral: assets are pulled one at a time (parallel is
easy), and the production worker's size matters more than any setting here.
Tab count should follow the machine, not be a constant.

---

## The upgrades

Each block ends in a PR and a stop, with a commit per part, as before.

### Block 1 — Moving through the site (Audit A)

1. **Auth without the round trip.** `getClaims()` in middleware and in
   `currentUser`. `currentUser`/`sessionIdentity` wrapped in React `cache()` so
   one request asks once. `getUser()` kept only where `new_email` is needed.
   Tests for the anonymous / addressed / expired-token cases.
2. **The wizard frame becomes a layout**, `projects/[id]/(wizard)/layout.tsx`,
   holding the bar, progress and All steps. Pages render only the middle.
3. **Loading boundaries everywhere.** A `loading.tsx` for home, the chooser,
   the overview, the film page, and a step: skeletons shaped like the real
   content, so prefetch delivers a shell and every tap changes the screen at
   once. Pressed states on wizard buttons.
4. **The step transition**: 200 ms slide/fade on the middle only,
   reduced-motion respected.
5. **The smaller items**: lazy-load the player on the film page, parallel
   poster signing and walk-through load on home.
6. **Proof**: the timed walk above becomes `pnpm perf`, run against a
   production build, with the before/after table in the PR.

### Block 2 — Recording (Audit B, capture)

1. **One camera for the whole walk-through.** The stream lives in a provider in
   the wizard layout from Block 1, so it survives moving between steps. The
   viewfinder is **live as soon as a recording step opens** (after the first
   permission), so Record starts in the same frame it is pressed, and you can
   see yourself before it counts. Switched off on leaving the wizard, on Save
   and leave, and when the tab is hidden.
2. **Uploads in the background.** An upload queue in the same provider: Keep
   and continue moves on **immediately**, the take keeps uploading, and the bar
   shows "Saving 1 take · 62%". Retries with backoff on a dropped connection;
   the "leave site?" warning while anything is queued; Make my film waits for
   the queue to drain and says so. No `router.refresh()` after a take: the
   screen already has it.
3. **Bounded file sizes.** An explicit bitrate (around 5 Mbps at 1080p, which is
   still well above what ingest keeps), recorded in one-second chunks.
4. **Proof**: the step-to-step flow timed with a fake camera
   (`--use-fake-device-for-media-stream`), plus one real take on the owner's
   phone.

### Block 3 — The preview (Audit B, editing)

1. **Preview copies made at ingest.** For each take a 720p H.264 with a
   keyframe every second and a small AAC track; for each photo a ~1600 px JPEG.
   The Player uses these, the render keeps using the full-quality files. Same
   timing and framing, so "picture and timing are exactly what you will get"
   stays true; the line about quality gets one honest clause.
   Existing films get copies through a backfill script, like
   `thumbs:backfill`.
2. **Premount and hold.** `premountFor` on every Sequence in the Player, and
   `pauseWhenBuffering` on picture and sound, so the next clip is ready before
   the cut, and a slow network pauses instead of stuttering out of sync.
3. **URLs that last the visit**: preview URLs signed for the length of a
   viewing session (a couple of hours), refreshed when the tab comes back.
4. **Proof**: a recorded playback of a real film before and after, with dropped
   frames counted from the Player's buffering events.

### Block 4 — Making the finished film, with the same file at the end

1. **Render while they watch.** Queue the delivery render when a cut is
   composed, not when it is approved. Approving the same cut finds the render
   done or under way; *deliver* still waits for the approval, as it does now.
   Approving a cut whose render was abandoned or failed queues it as today.
   Tests in the dispatcher for each of those.
2. **Tabs follow the machine.** `RENDER_CONCURRENCY`, defaulting to about a
   third of the cores (3 on this Mac), measured again on the production worker
   before launch.
3. **Pull assets in parallel**, a few at a time.
4. **The waiting screen tells the truth about time**: "Usually about four
   minutes", from what renders have actually taken, and "we'll email you" once
   SMTP exists.
5. **Proof**: the same real film rendered before and after, delivered files
   compared frame by frame, and the time from Approve to Ready.

Expected: Approve → Ready drops from ~6.5 minutes to **seconds** for anyone who
watches the preview, and to ~4 minutes for anyone who doesn't.

### Order

Block 1 first: it is the biggest win per line changed, and Block 2's camera and
upload queue need its layout. Blocks 3 and 4 are independent of everything else
and of each other.

## Owed by the owner

- ~~Say whether the final render belongs in this phase.~~ Yes, without
  compromising quality (2026-10-12): Block 4.
- **Approve the `getClaims()` trade-off** above (revocation up to an hour late).
- One real take on a phone after Block 2. It is still the one thing that can
  only be proven by hand.

---

## Block 1, as built (2026-10-12)

Branch `phase-8/fluid-navigation`. Measured with `pnpm perf` (new in this
block) against production builds of `main` and the branch, run alternately,
two rounds each, with the auth server's own response time sampled before
every run so a slow patch on it could not pass for an improvement:

| Tap | `main` | Branch |
|---|---|---|
| Start this film → chapter intro | 198–778 ms | 79–82 ms |
| Begin → first step | 180–401 ms | 30–31 ms |
| Continue (after typing) → next step | 315–579 ms | 32–46 ms |
| Skip for now → next step | 26–31 ms | 28–32 ms |
| Back → previous step | 27–28 ms | 27–28 ms |
| All steps → See the overview | 196–362 ms | 97–110 ms |
| Overview → home | 164–363 ms | 28–43 ms |

Every tap now lands under about a tenth of a second on this machine. Hosted
Supabase widens the gap rather than closing it: `main`'s auth calls each cross
the internet, and the branch makes none on an ordinary page.

What shipped:

1. **Auth verified locally** (`getClaims`, cached per request). The pending
   address is the only thing still asked of the auth server, and only for an
   identity without a proved one. A token with an altered subject is rejected
   (checked).
2. **The wizard frame is a layout** and stays mounted between steps (checked:
   the same element survives Begin, Continue, Skip and Back).
3. **Directional step transition**, 250 ms, reduced motion respected.
4. **The player loads only on the preview**: the film page's first load went
   from 224 KB to 128 KB, and the capture overview loads none of it (checked).
5. **Home signs posters and loads the resume card in parallel.**
6. **Continue redirects from the save action**: one round trip, not two.
7. **`pnpm perf`.**

What was tried and taken out, because the production build disagreed with the
plan:

- **Loading screens.** With any `loading.tsx` above a wizard step (the
  site-wide one or the wizard's own), Continue intermittently saved and
  *stayed on the same screen for good*. Bisected over production builds:
  `main` and the layout commit passed 4 of 4, every build with a loading screen
  above the step failed intermittently, and the branch with it removed passed
  5 of 5. The dev server never prefetches, so it never showed this. The
  film page's loading screen went too: it has save-then-refresh actions of its
  own, and the same bug there would be just as silent.
- **Full prefetch** of the next step. The first suspect; not the cause, and
  not needed.

Not measured: the film page's actions (Make my film, Approve) on a production
build with a real account. They don't navigate the way Continue does, but
they are the next thing to walk by hand.
