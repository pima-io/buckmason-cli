# buckmason CLI

Customer-facing Buck Mason CLI for agents. It wraps PIMA MCP catalog endpoints,
the customer-agent authorization flow, RMS order tracking / returns APIs, and
TypeScript lookbook tooling.

## Install

```bash
npm install -g @buckmason/cli
buckmason --help
```

For local development:

```bash
npm install
npm run build
./bin/dev.js products search --q "pima"
```

## Public Catalog

These commands use public `/mcp/buckmason/*` endpoints and do not require auth.

```bash
buckmason manifest
buckmason products search --q "daily shirt" --gender m
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

```bash
export BUCKMASON_PIMA_KEY=...
buckmason orders track BM123456
buckmason orders history --order-code BM123456
buckmason orders items BM123456
buckmason returns reasons --order-code BM123456
buckmason returns rates --order-code BM123456
buckmason returns locations --near-zip 90291
buckmason returns show RMA123 --order-code BM123456
buckmason returns postage RMA123 --order-code BM123456
buckmason returns exchange-options 123 --order-code BM123456
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

Customer RMS API commands require PIMA's brand-public API key via flag or env.
Account-wide commands also require the stored customer-agent token:

```bash
export BUCKMASON_PIMA_KEY=...
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

## Wardrobe Memory

Use wardrobe commands when the customer's agent should reason over what the
customer already owns. The cache is local by default at
`~/.buckmason/wardrobe.json`; it stores item facts from order history, not card
data or shipping addresses.

```bash
export BUCKMASON_PIMA_KEY=...
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
`checkout preview` / `checkout charge` only for fully agent-driven MPP checkout
after reading the live total back and receiving Link approval.

```bash
buckmason cart build --item 10543:L:1

buckmason checkout preview --body checkout.json
buckmason checkout charge --body checkout.json --acknowledged-total-cents 53200 --spt "$SPT" --confirm
```

## Lookbooks

The old Python utility scripts from `buck-mason-stylist-skill` have been ported
into TypeScript commands:

```bash
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
buckmason lookbook deploy --dir dist/lookbook --project buckmason-weekly-23 --kv-id "$LOOKBOOK_VOTES_KV_ID"
buckmason lookbook hosting
buckmason lookbook hosting --intent permanent
buckmason lookbook rank-votes --url https://example.pages.dev/
```

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
