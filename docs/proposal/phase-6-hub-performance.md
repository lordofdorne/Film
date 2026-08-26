# Phase 6 — The hub downloads the whole film to draw its thumbnails

**Status:** Steps 1 and 2 built and measured · 2026-08-25 · step 3 outstanding

> **Steps 1 and 2 are done.** Measured on the same film: **105.2 MB → 157 KB**
> across seventeen cards, 671× smaller, and a second render of the same page
> now produces **byte-identical URLs**, so every card is a cache hit. What
> follows is the original diagnosis, unchanged, with the outcome written under
> each step.

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

> **Built.** `assets.thumbnail_key`, a `thumbnail` stage, and a card that draws
> the still or a grey square — never the original. Measured on the same film:
> **105.2 MB → 157 KB across seventeen cards, 671× smaller.** Interviews came
> out 6–7 KB each, photographs 18 KB.
>
> Three things were decided while building it that the diagnosis had not
> settled:
>
> - **A stage of its own, not a line inside ingest.** Ingest's input hash
>   decides what is cached, so a new output means bumping the recipe — which
>   re-transcodes every take in every unfinished film, invalidates the cut and
>   re-renders it, minutes per project for a 40 KB JPEG. And it would still
>   miss every delivered film, because the dispatcher only plans active
>   projects. Ingest does write one now, while it has the file open and the
>   download is free; the stage is what reaches everything ingested before
>   today, and it skips an asset that already has one.
> - **No fallback to the original.** A card with no thumbnail yet draws a grey
>   square. Falling back would have left exactly the films whose ingest is
>   already cached slow for ever — the failure mode this was supposed to end.
> - **A second into the take, not frame zero.** Cameras open dark. Verified on
>   the owner's own film: the frames are properly exposed pictures of the
>   subject, not black squares. ffmpeg seeking past the end of a short answer
>   writes nothing and **exits zero**, so a take briefer than a second is
>   retried from its first frame.
>
> The dispatcher will not sweep a delivered film, so `pnpm thumbs:backfill`
> (dry run) / `--run` reaches those by hand. Run against all thirteen projects:
> 35 succeeded, and the rest are two old test films whose media is genuinely
> gone from the store — they were failing to draw before this too.
>
> The step sheet also stopped fetching a take to render a page: the `<video>`
> is `preload="none"` with the thumbnail as its poster, so opening a step to
> re-read the question no longer downloads the answer.

**2. Make the URL stable enough to cache.** Sign with an expiry rounded to a
window (say the current five-minute bucket) so the same key produces the same
URL within that window. The browser cache then works, `FreshenOnReturn` becomes
free, and the TTL stays short. This is a small change in `mediaUrl` and it is
what makes (1) hold rather than merely helping once.

> **Built, and verified against real R2 rather than predicted** — an R2
> assumption has been wrong here before. Signing the same key twice, a second
> apart, now returns the same string; without the flag it returns two. The URL
> fetches 200 and comes back carrying
> `cache-control: private, max-age=900, immutable`.
>
> `SignedUrlOptions.stableForSeconds` rounds the SIGNING clock down to a
> window — five minutes for thumbnails — and nothing else changes: same
> fifteen-minute cap, same private bucket, same single key and method.
>
> Two things the plan had not accounted for:
>
> - **A stable URL alone buys nothing.** R2 returns whatever `Cache-Control`
>   the object carries, and nothing was setting one, so a browser fell back to
>   heuristic caching — which for an object written minutes ago is none. The
>   header is written on the object at put time. The two halves only work
>   together.
> - **The window has to be capped against the TTL.** Rounding down spends life
>   the URL already had, so the guaranteed remainder is `ttl - window`; an
>   uncapped window could hand a browser a URL that expired before it arrived,
>   which would look like thumbnails that intermittently fail and leave nothing
>   in a log. `stableWindow` caps it at half the TTL.
>
> `Cache-Control` is deliberately NOT signed into the upload URL. Anything
> named in a presigned PUT is covered by the signature and must be echoed back
> verbatim or R2 answers 403 — the same trap ContentType already documents, and
> one local development cannot reproduce.
>
> One thing found by looking at real rows afterwards, not by reading the code:
> the thumbnail object is named `thumb-v{recipe}.jpg` so a recipe bump is not
> silently skipped, and **the dispatcher was still asking "is the column
> null?"** while the stage asked "is it THIS key?". One predicate now —
> `needsThumbnail` — used by the dispatcher, the backfill and the stage. Worth
> knowing alongside it: the name is what stops a re-run being skipped, and the
> recipe number in the input hash is what lets it run at all. Change both or
> change neither; a job whose stage row already succeeded is refused at claim
> time and does nothing, which is exactly-once working correctly.

**3. Stop loading the whole walkthrough to render one step.** The step sheet
calls `loadWalkthroughView`, which resolves all twenty-two steps and signs every
asset to display one. Only ~30 ms, so it is third — but it is also why a step
sheet costs the same as the hub.

> **Still outstanding.** Worth noting one thing found while doing (1): the hub's
> HTML carries a signed URL for every original as well as every thumbnail, and
> only the thumbnails are ever fetched. Signed URLs are bearer credentials, so
> the unused ones should not be minted at all. That is this step's job — the
> loader needs to know whether it is serving a hub or one step.

## What not to do

- Do not reach for parallel signing. It is 6 ms against 7 ms; it would look
  like a fix and change nothing.
- Do not make the bucket public or lengthen the TTL to get caching. These are
  recordings of somebody's grandmother; short-lived signed URLs are the point.
  Rounding the expiry keeps the guarantee and gets the cache.
- Do not judge any of this in `next dev`. It compiles per route and inflates
  every number; measure a production build before and after.
