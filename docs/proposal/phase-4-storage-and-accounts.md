# Phase 4 — Real storage, and an account you can sign into

**Status:** 2026-08-19 · **Part B is built and walked through. Part A's code
is built; its buckets are not.**

What is left, and only these:

- **Part A1** — the owner's Cloudflare dashboard steps, and the four `R2_*`
  variables. Nothing in the repository can do them.
- **Part A4** — the proving run against a real bucket. Everything in A3 is
  written and typechecked and has never met R2. **Do not mark this done on a
  passing test suite.**
- **Custom SMTP.** Deferred by the owner to last, and it is what stands
  between Part B and a real person using it.

Two things in the plan below turned out to be wrong when walked through, and
the code follows what happened rather than what was written here:

- **`secure_password_change = true` is wrong for this product** (§B2 asks for
  it). GoTrue applies it to setting a FIRST password too, and refuses any
  session that did not sign in within the last day — which is exactly the
  person being offered one. It is off, and `supabase/config.toml` says why.
- **§A3.4 looked in the wrong place.** `runDeliver` puts nothing; it only
  heads the object. The 120 MB read was in `render.ts`, and a second one in
  `ingest.ts`. Both stream now, through `@aws-sdk/lib-storage` so a failed
  part retries rather than the whole file.

One thing the plan did not anticipate, found by walking it: **a confirmation
in flight is invisible to `signInWithOtp`**, which will happily create a second
identity for the same address and strand the password on the first one.
`sendMagicLink` refuses while one is pending.

Two pieces of work the owner asked for on 2026-08-18, written so an agent with
no memory of the conversation can carry them out. Read `docs/CHECKPOINT.md`
first, then this. They are independent: **Part A (R2) and Part B (passwords)
can be done in either order, or by two people at once.** Nothing in one blocks
the other.

The owner's answers, which everything below follows from:

1. **Cloudflare means R2 object storage only.** Not hosting, not DNS.
2. **Password sign-in sits beside the magic link**, which stays.
3. **An address must be confirmed by email** before the account works.

---

## What is already true

Both jobs are smaller than they sound, because the hard parts are built.

- `packages/storage/src/r2.ts` is a complete `R2ObjectStore` — put, get, head,
  delete, deletePrefix, list, `signedGetUrl` (with `downloadAs` signed into the
  request) and `signedPutUrl`. **It has never run against a real bucket.**
- `storeFromEnv()` already switches on `R2_ACCOUNT_ID` and memoises the client.
- Supabase Auth already issues sessions, and `apps/web/src/server/auth.ts`
  already maps them to application rows.

So Part A is mostly configuration and one careful proving run, and Part B is
mostly one new page plus a bug that has to be fixed first.

---

# Part A — R2

## A4 was run on 2026-08-20, against the bucket `films`

The whole loop, in a browser, on real R2:

- A photograph uploaded from the step sheet PUTs to
  `films.<account>.r2.cloudflarestorage.com` — the bytes never touch the app
  server — and the asset row lands only after them.
- `/api/media` appears **zero** times in the hub's DOM. Thumbnails render from
  signed URLs.
- The worker ingests from R2, writes the normalised object back, and the QC
  note reaches the hub card in the customer's words: *"This looks a little soft
  on a big screen."*
- A signed download returns 200 with
  `content-disposition: attachment; filename="Ada Lovelace — Life Advice v1.mp4"`.
- `deletePrefix` removed 3 of 3 and left none.

Not proved, and it cannot be until Block 8: **a finished film downloaded
through the UI**. Nothing reaches render without transcription.

One thing to know, because it wasted half an hour: a worker started **before**
the R2 variables were corrected went on failing ingest with a nonsense error
(`ENOENT: open 'source.jpg'`) long after `.env` was right. Env is read at boot.
**Restart the worker after touching `.env`** — the same class of mistake as the
stale `next-server` in the checkpoint, and it looks like a bug in the code
rather than in the process table.

## A0. Measured against a real bucket on 2026-08-20

The warning below was half right, and the wrong half was the loud one.

- **Content type is not signed at all.** `X-Amz-SignedHeaders=host`, and
  nothing else — the presigner treats `content-type` as unsignable for a
  presigned URL. Signing `video/webm` and sending
  `video/webm;codecs=vp9,opus` returns **200**, not the 403 predicted here.
  Making the client echo the signed type is still worth having, because it is
  what decides the content type R2 stores and it now matches the row, but it
  was never the thing that would break every recording.
- **CORS is exactly as load-bearing as claimed.** An unconfigured bucket
  answers the preflight with **403 and no `access-control-allow-*` headers at
  all**, so the browser refuses the PUT before it is sent. The symptom is
  uploads failing while `curl` works — and *not* broken thumbnails, since an
  `<img>` or `<video>` src is not a CORS request.
- **An Object Read & Write token cannot read or write the CORS policy**
  (`GetBucketCors` → AccessDenied). It is a dashboard job, or a job for an
  Admin token, and no amount of code in this repository can do it.

## A0b. The bug to know about before starting

**The browser PUTs directly to R2.** `mintUpload` in
`apps/web/src/server/capture.ts` returns a signed PUT URL and `StepClient.tsx`
fetches it with `method: "PUT"`. That is a cross-origin request from
`https://yourapp` to `https://<account>.r2.cloudflarestorage.com`, so **R2's
CORS policy is load-bearing**: without it every upload fails in the browser
with an opaque network error, while `curl` against the same URL works
perfectly. Budget for this being the thing that costs the afternoon.

The signature covers `ContentType` (see `signedPutUrl`), so the browser's
`content-type` header **must match exactly** what was signed. `StepClient`
already sends the same string it asked to mint with, including MediaRecorder's
`;codecs=` parameter — but `prepareUpload` strips the codecs parameter via
`baseType()` before minting. **Verify these two agree against a real bucket.**
If they do not, the fix is to sign what the browser will actually send.

## A1. What the owner does in the Cloudflare dashboard

Claude cannot create accounts or API tokens. These are yours:

1. **Create two buckets**: one for production, one for development — e.g.
   `film-media` and `film-media-dev`. Never point a development machine at the
   production bucket; `deletePrefix` is real.
2. **Create an R2 API token** (R2 → Manage API Tokens) with **Object Read &
   Write**, scoped to those buckets. It shows the Access Key ID and Secret
   **once**.
3. **Set the CORS policy on each bucket** (R2 → bucket → Settings → CORS):

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3200", "https://YOUR-PRODUCTION-ORIGIN"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["etag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   `AllowedOrigins` must be exact origins, no trailing slash and no wildcard —
   a wildcard here would let any site on the internet use a leaked URL.
4. **Keep the buckets private.** No public bucket, no custom domain on the
   bucket. Every read is a signed URL with a short TTL, and that is deliberate:
   these are recordings of somebody's grandmother.
5. **Add a lifecycle rule** to abort incomplete multipart uploads after 7 days.
   Nothing uses multipart yet, but the rule costs nothing and prevents paying
   for invisible garbage later.

**Do not send the secret key to Claude.** It goes in your own gitignored `.env`
and in the deployment's environment.

## A2. Env

Four variables, in the root `.env`, in the block the file already has for them:

```
R2_ACCOUNT_ID=...
R2_BUCKET=film-media-dev
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

Setting `R2_ACCOUNT_ID` to anything non-empty is what flips the whole system
over — `storeFromEnv()` and `usingLocalStore()` both key on it. The web app and
the worker **must get identical values**; disagreeing about storage is the
failure mode that produces a blank preview with no error anywhere.

## A3. Code changes

Genuinely small. In order:

**1. `/api/media` and the download route become unreachable, and should say so
clearly rather than accidentally.** Both already branch on `instanceof
LocalObjectStore`. Read them and confirm the R2 path is the redirect-to-signed-
URL path, and that the media route's 404 for remote storage is what the hub and
step sheets actually want — `loadWalkthroughView` calls `mediaUrl`, which
returns a signed URL when not local, so nothing should reach `/api/media` at
all. **Prove that by grepping the rendered HTML for `/api/media` after
switching to R2; it must not appear.**

**2. Signed-URL TTL versus page lifetime.** The hub signs a URL per card at
render time with a 900-second cap. Somebody who leaves the hub open for an hour
and then scrolls will see broken thumbnails. Decide and implement one of:

- Accept it, and make the hub revalidate — it is a server component, so a
  `router.refresh()` on window focus is a few lines and also picks up new QC
  notes. **Recommended.**
- Or sign on demand from a route handler when an image is actually requested.
  More correct, more machinery.

**3. `pnpm bed:upload` must be re-run against R2.** The bed lives at
`tracks/<id>/bed.json` plus its source, outside any project prefix, and a fresh
bucket does not have it. `finishCapture` fails with a clear message if it is
missing — which is the correct behaviour and also exactly what will happen on
first use if this step is forgotten.

**4. Check what `put` does with a 116 MB film.** `runDeliver` reads the render
output and puts it. `R2ObjectStore.put` accepts a stream, so confirm the
delivery stage passes a stream rather than a fully-buffered `Uint8Array` — a
worker holding 116 MB in memory per concurrent render is survivable but
avoidable, and this is the moment to look.

## A4. Proving it

Do not declare this done on a passing test suite. The whole point is that this
code has never touched a real bucket. **Run the walk-through end to end in a
browser against `film-media-dev`:**

- Upload a photograph on a step. It must reach R2 (check the bucket), and the
  asset row must land only after the bytes (that ordering is an invariant).
- Confirm the browser PUT goes to `r2.cloudflarestorage.com`, not to the app.
- Confirm the hub thumbnails and the step-sheet playback render from signed
  URLs.
- Run the worker: ingest must fetch from R2, write the normalised object back,
  and the QC note must appear on the hub card.
- Finish a film, approve it, and download it — the download route must **302 to
  a signed URL**, and the file must arrive with the customer's filename.
- Delete a project's prefix and confirm the objects are gone.

Every serious bug in this project so far was found by putting real media
through the real UI. This will be no different.

---

# Part B — Email and password

## B0. The bug that must be fixed first

**`linkIdentity` never updates a row's email.** In
`packages/db/src/identity.ts` the first branch is:

```ts
const linked = await db.select().from(users).where(eq(users.authId, identity.authId)).limit(1);
const already = linked[0];
if (already !== undefined) {
  return { id: already.id, email: already.email, authId: already.authId };
}
```

Matching on `authId` first is correct and must stay. But it returns the stored
row **without comparing `identity.email` to `already.email`** — which was
harmless when an identity's address never changed, and is wrong the moment an
anonymous user gains one.

That is exactly what Part B does. An anonymous visitor makes a film; their row
is `email = NULL`. They set a password; Supabase gives that same `auth.users`
row an address, **keeping the same id**. Every later request calls
`linkIdentity` with the real address, matches by `authId`, and returns
`email: null` for ever. The database never learns where to send the film.

**Fix it before writing any password code, with a test first.** When the row's
email differs from the verified identity's, update it. Two rules the update
must obey:

- Only ever fill in or change the address on a row whose `authId` already
  matches. Never touch a row matched by address alone.
- The unique constraint on `users.email` can reject the update — somebody
  else's row already holds that address. That collision must **refuse loudly**,
  the way the existing one does, never silently leave the row stale. Extend
  `packages/db/test/identity.test.ts`; the anonymous-gains-email cases added in
  Phase 3b are the place to put it.

## B1. The design decision that saves a block of work

**Converting an anonymous user keeps the same auth id**, so the films need no
adoption at all — they are already owned by that id. Use
`supabase.auth.updateUser({ email, password })` on the anonymous session, **not**
`signUp()`. `signUp()` creates a *second* identity and orphans the work.

`adoptFilms` stays exactly as it is: it is still the right mechanism for the
magic-link path, where clicking a link in a different context genuinely does
produce a different identity.

## B2. Supabase configuration

In `supabase/config.toml`, and matched in the hosted dashboard:

```toml
[auth.email]
enable_signup = true
enable_confirmations = true      # currently false; the owner asked for confirmation
secure_password_change = true    # require the current password to change it

[auth]
minimum_password_length = 8      # currently 6
password_requirements = "lower_upper_letters_digits"
```

Also enable **leaked-password protection** (HIBP) in the hosted dashboard if
the plan is available. A password reused from a breach is the likeliest way one
of these accounts is ever taken.

**`enable_confirmations = true` changes the magic-link flow's timing** — verify
the existing magic link still works after flipping it, before building anything
new on top.

## B3. What to build

**1. `/signin` gains a password branch.** It currently has one email field and
one button. It becomes: address, password, "Sign in" — plus "Email me a link
instead" and "Forgot your password?" as quiet secondary paths. Keep the whole
thing one page; a separate `/login` and `/signup` is two doors to the same room.

`signInWithPassword` failures must **not** distinguish "no such account" from
"wrong password". One message: "That email and password do not match." The
existing magic-link error handling is deliberately explicit because a magic
link creates the user and there is nothing to leak; **this is the opposite
case**, and the reasoning is worth a comment so nobody "improves" it later.

**2. Setting a password is an offer, never a gate.** The film must remain
finishable without an account — that is the entire premise of Phase 3b, and
this is the block most likely to quietly undo it. Two places to offer it:

- On the "One click, whenever suits" screen in `DetailStepClient.tsx`, which
  already appears after the address is saved. Add "…or set a password now" as
  a second option beside the link.
- On the finished film, where "keep this" has obvious meaning.

Nowhere else. No interstitial, no modal, nothing between a person and the next
question.

**3. Password reset.** `resetPasswordForEmail` → the email → `/auth/callback` →
a form that calls `updateUser({ password })`. The callback route already
exchanges codes and adopts films; **read it before changing it** — the anonymous
adoption logic there is subtle and must not be disturbed by adding a recovery
branch. A recovery session is a real session, so the route must distinguish
"signed in to use the app" from "signed in only to set a new password".

**4. `apps/web/app/page.tsx` shows `user.email`,** which is null for anonymous
users. Check what it renders today and make it honest — "Not signed in" rather
than an empty gap.

## B4. What must stay true

- **Anonymous capture still works end to end with no account.** Test it after
  every change in this part.
- **`getUser()`, never `getSession()`.** Unchanged and non-negotiable.
- **404, never 403**, on every project surface.
- **Claude never handles a real password.** Building the form is the job;
  typing credentials into it is the owner's.

---

## Open questions for the owner

- **Custom SMTP is now a hard blocker, not a nice-to-have.** Confirmation
  emails, reset emails and magic links all go through it, and Supabase's
  built-in sender allows roughly two an hour. Nothing in Part B is usable by a
  real person until Resend (or similar) is configured. This was already on the
  list; Part B is what makes it urgent.
- **How long should an abandoned project live?** Still unanswered, and R2 makes
  it cost money rather than disk space. `projects.retention_expires_at` exists
  and nothing sets it.
- **Which speech-to-text provider** — still the thing standing between all of
  this and a film anyone can actually receive. Deferred on 2026-08-17.

## What does not change

- The row is written only after the bytes land.
- Guidance copy lives in the template.
- Authorisation is checked where the data is.
- `captureReadiness` is the single source for both progress and the gate.
- Postgres is the source of truth; the queue is an accelerator.
