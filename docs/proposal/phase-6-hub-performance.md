# Phase 6 — The hub downloads the whole film to draw its thumbnails

**Status:** Diagnosed and measured · 2026-08-24 · not yet fixed

## What is actually happening

Opening the hub, or any step sheet, is slow because **every card fetches the
customer's original media at full size.**

`loadWalkthroughView` in `apps/web/src/server/capture.ts` builds each card's URL
from `asset.storageKey` — the ORIGINAL — and `Hub.tsx` puts that straight into
the page:

```tsx
<img src={step.asset.url} … />            // a 7 MB photograph, drawn 64px wide
<video src={step.asset.url} preload="metadata" … />   // a whole interview take
```

Measured on the owner's own film:

| | |
|---|---|
| originals referenced by the hub | **105 MB across 18 assets** |
| the three photographs alone | **18.2 MB** (7.3 + 4.2 + 6.7) |
| CSS size they are drawn at | a thumbnail |

The server is not the problem, and it is worth saying so before anyone tunes
the wrong thing. Measured on the same film:

- loading every row: **11 ms** warm (269 ms cold)
- signing 17 URLs sequentially: **7–28 ms** (6 ms in parallel — not worth it)
- a step page server-render: **~215 ms**, nearly all Next dev compilation

## And nothing is ever cached

Worse than the size: **every render mints a fresh signature**, so `src`
changes every time. The browser cache can never hit, and the 105 MB is
re-fetched on:

- every visit to the hub,
- every return to a step and back,
- **every window focus** — `FreshenOnReturn` refreshes the hub on
  `visibilitychange`, which was added to keep signed URLs alive and QC notes
  current, and now re-downloads the film to do it.

That last one is the difference between "slow once" and "slow constantly".

## The fix, in the order worth doing it

**1. Serve a thumbnail, not the original.** `ObjectKind` already has `still`
and nothing writes one. Ingest should write a small JPEG — a few hundred pixels
wide, tens of kilobytes — beside the normalised object, and the hub should ask
for that. For a take, a poster frame instead of `<video src>`, so a card costs
one small image rather than a video element opening a connection.

Expected: **105 MB → under 1 MB.**

**2. Make the URL stable enough to cache.** Sign with an expiry rounded to a
window (say the current five-minute bucket) so the same key produces the same
URL within that window. The browser cache then works, `FreshenOnReturn` becomes
free, and the TTL stays short. This is a small change in `mediaUrl` and it is
what makes (1) hold rather than merely helping once.

**3. Stop loading the whole walkthrough to render one step.** The step sheet
calls `loadWalkthroughView`, which resolves all twenty-two steps and signs every
asset to display one. Only ~30 ms, so it is third — but it is also why a step
sheet costs the same as the hub.

## What not to do

- Do not reach for parallel signing. It is 6 ms against 7 ms; it would look
  like a fix and change nothing.
- Do not make the bucket public or lengthen the TTL to get caching. These are
  recordings of somebody's grandmother; short-lived signed URLs are the point.
  Rounding the expiry keeps the guarantee and gets the cache.
- Do not judge any of this in `next dev`. It compiles per route and inflates
  every number; measure a production build before and after.
