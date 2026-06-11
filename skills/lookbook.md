# Buck Mason Lookbook Skill

Use this skill for Buck Mason lookbooks, event scoring, partner voting, and
vote-to-checkout handoffs.

## Commands

- `buckmason lookbook settings --occasion travel --season summer --region "Los Angeles"`
  Fetches curated setting, composition, and prompt guidance from PIMA.

- `buckmason lookbook score-event --file event.json`
  Scores a calendar event as `skip`, `soft`, `editorial`, or `premium`.

- `buckmason lookbook profile --file profile.md`
  Parses sizes, reference photos, hosting prefs, and payment prefs from the
  customer profile.

- `buckmason lookbook discover-candidates --gender m --sizes '{"shirt":"L"}'`
  Finds weekly candidates from recent catalog items, deduped against wishlist.

- `buckmason lookbook run --weekly --profile profile.md`
  Runs the headless pipeline. Premium runs stop at
  `READY_FOR_PREMIUM_IMAGE_STEP` and write `image-plan.json`.

- `buckmason lookbook image-plan --config config.json --picks picks.json --profile profile.md`
  Builds deterministic `gpt-image-2` prompts and input ordering. Garment images
  come before identity photos.

- `buckmason lookbook generate-images --plan image-plan.json --out runs/<id>/looks`
  Explicitly calls OpenAI image edits for premium try-on images. This is never
  hidden inside `build`.

- `buckmason lookbook verify-face --generated look1.png --reference portrait.jpg --reference body.jpg`
  Runs the face verification gate before premium images ship.

- `buckmason lookbook build --config config.json --picks picks.json --look-images runs/<id>/looks --out out/lookbook`
  Builds premium deterministic `index.html`, `lookbook.json`, and `.lookbook_id`.

- `buckmason lookbook build --config config.json --picks picks.json --no-tryon --out out/lookbook`
  Builds editorial tier from product imagery.

- `buckmason lookbook validate --dir out/lookbook`
  Checks that the local artifact has an index and machine-readable manifest.

- `buckmason lookbook deploy --dir out/lookbook --project <project>`
  Prepares and deploys to Cloudflare Pages via `wrangler`. Voting is on by
  default with a per-lookbook Durable Object and SQLite tally storage. The CLI
  reuses or creates a `LOOKBOOK_VOTES` KV namespace unless `--kv-id` is
  provided, but that namespace is only for legacy ballot import. Pass
  `--no-voting` only for explicitly read-only lookbooks.

- `buckmason lookbook hosting`
  Shows hosting hints for the built HTML. Default to Cloudflare Pages via
  `wrangler`; use Vercel as the next durable hosted fallback, S3 only when the
  customer has an explicit bucket, local/Tailscale for private review, and 0x0.st
  only for temporary public links.

- `buckmason lookbook rank-votes --url <url>`
  Reads `/lookbook.json` plus `/api/votes?public=1&fresh=1` and emits a
  checkout handoff. This never places an order.

## Safety

Votes are not purchase consent. After ranking votes, re-check live price and
stock with `buckmason products show` or `buckmason stock check`, read back the
cart and total with `buckmason checkout preview`, then use `buckmason checkout
charge --confirm` only after explicit customer confirmation and Link approval.

Hosting is also a publish action. Confirm before making a public URL unless the
customer explicitly pre-authorized recurring deploys. If a host CLI exists but
is unauthenticated, treat it as unavailable and fall through rather than starting
login or account setup inside the lookbook flow.

Premium try-on images are sensitive. Use at least two customer reference photos
when possible, do not pass fully dressed reference photos that could anchor the
wrong outfit/backdrop, and do not downgrade from `gpt-image-2` silently. If face
verification fails, regenerate once with a stronger identity block or fall back
to editorial for that look.
