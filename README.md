# buckmason CLI

Customer-facing Buck Mason CLI for agents. It wraps PIMA MCP catalog endpoints,
the customer-agent authorization flow, RMS order tracking / returns APIs, and
TypeScript lookbook tooling.

## Install

```bash
npm install -g @buckmason/cli
buckmason --help
```

## Agent Recipes

Use these prompts when you want an agent to combine catalog search, wardrobe
memory, stock checks, lookbook generation, calendar context, and checkout
handoffs. Checkout still requires explicit customer approval.

- "Check daily for new arrivals, compare them against my wardrobe and saved
  sizes, and send me a lookbook only when something meaningfully improves my
  closet."
- "Watch my calendar for trips and events, then build location-aware lookbooks
  with owned outfits first and local pickup or shipping options only where they
  help."
- "Use my wardrobe, tomorrow's weather, and the event dress code to propose
  three looks, then identify one optional in-town purchase that would complete
  the best one."
- "Before I visit a city, build me a local pickup lookbook using stores near my
  hotel."
- "Before a work trip, make a packing lookbook from pieces I already own, with
  optional ship-to-hotel backups."
- "When something I liked is back in stock in my size, tell me why it works with
  my wardrobe."
- "Audit my recent orders and suggest returns or exchanges before the return
  window closes."
- "Build a do-not-buy list by comparing new releases against similar pieces I
  already own."
- "Make a date-night, wedding, or conference lookbook from my wardrobe, then
  fill the weakest gap with in-town inventory."
- "If I am near a Buck Mason store, show me the best five things to try on based
  on my wardrobe and recent favorites."
- "Turn a calendar event into a lookbook using dress code, weather, venue,
  transit, and pickup timing."
- "After I vote on a lookbook, rank the winners and prepare a checkout handoff,
  but stop before payment approval."
- "Make me a seasonal capsule refresh: what to keep wearing, what to add, and
  what to skip."
- "Track items I passed on and tell me if they later become a better fit because
  of weather, travel, sale, or stock changes."
- "Generate a one-bag weekend lookbook using only pieces I own plus at most two
  purchasable additions."
- "Compare online shipping versus local pickup for the items in a lookbook and
  recommend the fastest realistic path."

## Public Catalog

These commands use public `/mcp/buckmason/*` endpoints and do not require auth.

```bash
buckmason manifest
buckmason products search --q "daily shirt" --gender m
buckmason products search --gender m --sort newest --days 90
buckmason products seasonal --gender m --days 45
buckmason products show 10543 --near-zip 90291
buckmason products imagery 10543
buckmason categories list --gender m
buckmason stock check BM13211.679NATL --near-zip 90291
buckmason locations list --near-zip 90291 --pickup
buckmason recommend --gender m --occasion travel --dress-code smart_casual
```

## Customer Authorization

Single-order tracking and returns should use the order code first. It avoids an
email round trip and does not issue a session token.

Buck Mason's public return policy advertises full refunds within 365 days of
purchase for items that are unworn, unwashed, undamaged, and still have their
original tags. Treat that as policy context, not a local eligibility
calculation: run `buckmason orders items <order-code>` before promising a return,
because PIMA/RMS is the source of truth for `rms_returnable`, final sale,
alterations, shipment state, and any policy exceptions.

```bash
buckmason orders track BM123456
buckmason orders history --order-code BM123456
buckmason orders items BM123456
buckmason returns reasons --order-code BM123456
buckmason returns rates --order-code BM123456
buckmason returns locations --near-zip 90291
buckmason returns show RMA123 --order-code BM123456
buckmason returns postage RMA123 --order-code BM123456
buckmason returns exchange-options 123 --order-code BM123456
buckmason support contact
```

Use customer-agent authorization only when the customer wants account-wide
history, such as seeding a wardrobe from every past order.

```bash
buckmason auth login --email customer@example.com
buckmason auth status
```

The agent receives a security code and polls PIMA. The customer receives an
email, opens the PIMA link, confirms the security code, and clicks
"Authorize your agent." The CLI stores only the scoped Bearer token returned by
PIMA.

Customer RMS API commands use Buck Mason's built-in brand-public PIMA key.
Override it with `--key` or `BUCKMASON_PIMA_KEY` only for staging or another
tenant. Account-wide commands also require the stored customer-agent token:

```bash
buckmason orders history
buckmason orders track BM123456 --account
buckmason returns address
buckmason returns reasons
buckmason returns rates
buckmason returns payment-token --shipping-rate-id 12
buckmason returns start --email customer@example.com --order-code BM123456 --item 123:4:original --confirm
buckmason returns start --email customer@example.com --order-code BM123456 --item 123:4:exchange:456 --address return-address.json --confirm
buckmason returns start --email customer@example.com --items-file return-items.json --address-id 789 --payment-intent-id pi_123 --confirm
```

`returns start` accepts repeatable `--item order_item_id:reason_id:return_type[:exchange_sku_id]`
flags, or `--items-file` containing an RMS-shaped `items_attributes` array.

## Customer Support

Use `support contact` when the customer only needs the same public help
channels shown on Buck Mason's FAQ/contact page. It prints the support email,
text/phone number, FAQ/chat page, tracking and returns links, store lookup, gift
card balance link, and policy notes. It does not send a message or create a
ticket.

```bash
buckmason support contact
buckmason support contact --json
```

## Wardrobe Memory

Use wardrobe commands when the customer's agent should reason over what the
customer already owns. The cache is local by default at
`~/.buckmason/wardrobe.json`; it stores item facts from order history, not card
data or shipping addresses.

```bash
buckmason wardrobe sync
buckmason wardrobe list --category jean
buckmason wardrobe show BMJEAN.IND31
buckmason wardrobe pair BMJEAN.IND31
buckmason wardrobe outfit --occasion work --weather cool
buckmason wardrobe match-new BMJEAN.IND31 --days 45 --gender m
```

Use `wardrobe pair` for "what goes with these jeans?" and `wardrobe match-new`
for "does Buck Mason have anything new that works with them?" The latter checks
recent Buck Mason catalog items and ranks them against the owned anchor item.

## Cart and MPP Checkout

Use `cart build` when the customer wants a normal Shopify cart link. Use
`checkout mpp` for fully agent-driven MPP checkout after reading the live total
back and receiving approval through Stripe Link CLI (`link-cli`). Use
`checkout hosted` when the customer's agent cannot complete MPP payment
directly; PIMA creates a short-lived branded checkout page with the cart,
contact, delivery, coupon, and customer credit choices prefilled.

MPP checkout flow:

1. Find the customer-approved Link payment method with
   `link-cli payment-methods list`.
2. Read the live total back to the customer.
3. Run `buckmason checkout mpp --confirm`; it previews the cart, creates a Link
   shared-payment-token spend request, polls for approval, and submits the
   one-time token to PIMA without printing it.

```bash
buckmason cart build --item 10543:L:1

buckmason checkout mpp \
  --body checkout.json \
  --payment-method-id csmrpd_xxx \
  --confirm

# Fallback when Link CLI payment is unavailable:
buckmason checkout mpp --body checkout.json --hosted
```

Low-level MPP debugging flow:

1. Preview the checkout body with `buckmason checkout preview`.
2. Read the live total back to the customer.
3. Request payment approval in Stripe Link CLI and capture the returned SPT.
4. Charge with `buckmason checkout charge`, passing that SPT via `--spt`.

```bash
buckmason checkout preview --body checkout.json
buckmason checkout charge --body checkout.json --acknowledged-total-cents 53200 --spt "$SPT" --confirm
```

Hosted checkout flow:

1. Create the hosted checkout with the same checkout body and any preselected
   shipping, pickup, coupon, or credit choices.
2. Send the `hosted_checkout_url` to the customer.
3. Poll the `checkout status` command until it is completed, canceled, expired,
   or failed.

```bash
buckmason checkout hosted --body checkout.json --shipping-rate-code two-day
buckmason checkout status <token> --watch
```

`checkout mpp --hosted` is a shorthand for the same handoff path: it uses the
MPP checkout body shape, creates the branded hosted checkout, and prints the
poll command the agent should run while the customer approves or cancels.

SKUs follow the same ship/pickup rules as buckmason.com: `buckmason stock
check <sku>` reports `fulfillment.mode` (`ship_or_pickup`, `ship_only`,
`pickup_only`, `unavailable`) and the eligible pickup stores. MPP checkout
enforces the gate on both the preview and the charge call — a pickup-only SKU
must carry a pickup location (`--line-item <sku>:<qty>:<pickup-location-slug>`
or `--pickup-location-slug`), a ship-only SKU must not, and violations come
back as a 422 `fulfillment_unavailable` error listing per-item reasons plus
the stores that could fulfill them.

## Lookbooks

The lookbook system turns a customer profile, event context, live Buck Mason
catalog data, and curated picks into a hosted buying guide. It can build
editorial lookbooks from product imagery or premium lookbooks with generated
try-on images, then validate and deploy the finished `index.html` plus
`lookbook.json` manifest.

Hosted lookbooks are designed for collaborative review. Cloudflare Pages deploys
include like/pass voting for whole looks and individual pieces by default, plus
`lookbook rank-votes` to convert the current vote tally into a checkout handoff.
The voting backend uses a per-lookbook Durable Object with SQLite tally storage,
edge-cached reads, and batched WebSocket fanout; KV is only used to import older
ballots when a previously deployed lookbook is upgraded.
Votes are preference signals only; the agent still re-checks live stock, prices,
fulfillment, discounts, credits, and explicit payment approval before charging.

Examples:

- [Palm Springs trip lookbook](https://buckmason-2026-05-05-palm-springs-trip-v2.pages.dev/)
- [LA dinners and weekend lookbook](https://buckmason-2026-05-11-la-dinners-weekend.pages.dev/)

Lookbook workflows are exposed as TypeScript commands:

```bash
buckmason lookbook trip --plan trip-plan.json --person john-collison --generate-images --deploy --project buckmason-john-spain-august
buckmason lookbook profile --file profile.md
buckmason lookbook settings --occasion travel --season summer --region "Los Angeles"
buckmason lookbook score-event --file event.json
buckmason lookbook discover-candidates --gender m --sizes '{"shirt":"L","pant":"31"}'
buckmason lookbook run --weekly --profile profile.md
buckmason lookbook image-plan --config lookbook-config.json --picks picks.json --profile profile.md --out image-plan.json
buckmason lookbook generate-images --plan image-plan.json --out runs/<lookbook-id>/looks
buckmason lookbook verify-face --generated runs/<lookbook-id>/looks/look1.png --reference /path/portrait.jpg --reference /path/body.jpg
buckmason lookbook build --config lookbook-config.json --picks picks.json --look-images runs/<lookbook-id>/looks --out dist/lookbook
buckmason lookbook build --config lookbook-config.json --picks picks.json --no-tryon --out dist/lookbook
buckmason lookbook validate --dir dist/lookbook
buckmason lookbook deploy --dir dist/lookbook --project buckmason-weekly-23
buckmason lookbook hosting
buckmason lookbook hosting --intent permanent
buckmason lookbook rank-votes --url https://example.pages.dev/
```

Use `lookbook trip` for destination or customer-specific briefs. It reads a
single JSON plan, resolves a reusable local person preset from
`~/.buckmason/people/<person>/profile.md` or an explicit `--profile`, hydrates
the selected product ids from PIMA with live stock, writes the config, picks,
and image plan into `~/.buckmason/runs/<lookbook-id>/`, enforces complete
top-plus-bottom looks before image generation, optionally generates premium
try-on images, validates the HTML, deploys through Wrangler, and smoke-checks
the public page, manifest, voting endpoints, and Open Graph image.

Premium image generation is explicit. `lookbook run --tier premium` writes
`image-plan.json` and exits with `READY_FOR_PREMIUM_IMAGE_STEP` until the agent
runs `lookbook generate-images`. The generated images are stamped with
`.lookbook_id`, and premium resume/build verifies faces with `lookbook
verify-face` unless `--no-verify` is explicitly used.

The TypeScript builder writes deterministic `index.html`, `lookbook.json`, and
`.lookbook_id`. It does not require Python, Pillow, or curl.

Hosting guidance defaults to Cloudflare Pages via `wrangler`. Vercel is the
next durable hosted fallback; S3 is opt-in only with an explicit customer bucket;
local/Tailscale is for private review; 0x0.st is a temporary public fallback.

## Local Development

```bash
npm install
npm run build
./bin/dev.js products search --q "pima"
```
