# Buck Mason CLI Getting Started

Use this skill when a customer asks an agent to shop, check stock, track orders,
start a return, or build a Buck Mason lookbook.

## Public workflows

- Search catalog: `buckmason products search --q "<term>" --gender m`
- Seasonal discovery: `buckmason products seasonal --gender m --days 45`
- Product detail: `buckmason products show <product-id> --near-zip <zip>`
- Product imagery: `buckmason products imagery <product-id>`
- Taxonomy: `buckmason categories list --gender m`
- SKU stock: `buckmason stock check <sku> --near-zip <zip>`
- Stores: `buckmason locations list --near-zip <zip> --pickup`
- Recommendations: `buckmason recommend --gender m --occasion travel`
- Cart permalink: `buckmason cart build --item <product-id>:<size>:1`

Public workflows do not require account authorization.

## Order-code workflows

Use order codes for single-order tracking and most returns. This path does not
send email and does not issue a customer-agent token.

- Tracking: `buckmason orders track <order-code>`
- One-order history: `buckmason orders history --order-code <order-code>`
- Item returnability: `buckmason orders items <order-code>`
- Return reasons: `buckmason returns reasons --order-code <order-code>`
- Return rates: `buckmason returns rates --order-code <order-code>`
- Return stores: `buckmason returns locations --near-zip <zip>`
- Exchange options: `buckmason returns exchange-options <order-item-id> --order-code <order-code>`
- Return start: `buckmason returns start --order-code <order-code> --item <order-item-id>:<reason-id>:<type> ... --confirm`
- Label retry: `buckmason returns postage <return-id-or-code> --order-code <order-code>`

## Account workflows

Use account authorization only when the customer explicitly wants account-wide
order history, such as wardrobe seeding from every past order.

1. Run `buckmason auth login --email <customer-email>`.
2. Tell the customer the security code printed by the CLI.
3. The customer opens the PIMA magic-link email and clicks `Authorize your agent`.
4. Use:
   - `buckmason orders history`
   - `buckmason orders track <order-code> --account`
   - `buckmason wardrobe sync`
   - `buckmason wardrobe outfit --occasion <occasion> --weather <weather>`
   - `buckmason wardrobe pair <sku-or-product-name>`
   - `buckmason wardrobe match-new <sku-or-product-name> --days 45`
   - `buckmason returns reasons`
   - `buckmason returns rates`
   - `buckmason returns address`
   - `buckmason returns start ... --confirm`

Do not create a return until the customer has confirmed the exact item, reason,
address, shipping rate, and any fee.

For an exchange, first list exchange options, have the customer choose the
replacement size/color, then pass that option's `sku_id` as
the fourth field in `--item <order-item-id>:<reason-id>:exchange:<sku-id>`.
Use `--items-file` for multi-item or mixed return/exchange requests.

## Wardrobe workflows

Use this when the customer asks what to wear, what goes with an owned item, or
whether a new Buck Mason item complements their wardrobe.

- Sync local wardrobe: `buckmason wardrobe sync`
- List owned pieces: `buckmason wardrobe list --status owned`
- Find jeans or another anchor: `buckmason wardrobe list --category jean`
- Pair owned pieces: `buckmason wardrobe pair <sku-or-product-name>`
- Suggest today's outfit: `buckmason wardrobe outfit --occasion work --weather cool`
- Match new catalog items: `buckmason wardrobe match-new <sku-or-product-name> --days 45`

Use wardrobe output for recommendations only. Before purchase, re-check live
stock/price and get explicit checkout approval.

## Lookbook workflows

- Fetch settings: `buckmason lookbook settings --occasion travel --season summer`
- Score an event: `buckmason lookbook score-event --file event.json`
- Build premium HTML: `buckmason lookbook build --config config.json --picks picks.json --look-images runs/<id>/looks --out out/lookbook`
- Build editorial HTML: `buckmason lookbook build --config config.json --picks picks.json --no-tryon --out out/lookbook`
- Validate HTML: `buckmason lookbook validate --dir out/lookbook`
- Deploy HTML: `buckmason lookbook deploy --dir out/lookbook --project <project> --kv-id <kv-id>`
- Hosting hints: `buckmason lookbook hosting` (default: Cloudflare Pages via `wrangler`; fallback: Vercel, explicit-bucket S3, local/Tailscale, then temporary 0x0.st)
- Rank votes: `buckmason lookbook rank-votes --url <lookbook-url>`

## Fulfillment rules (ship vs pickup)

Every SKU follows the same fulfillment rules as buckmason.com. `buckmason
stock check <sku>` (and each variant in `buckmason products show`) returns a
`fulfillment` gate:

- `ship_or_pickup` — can ship, or be picked up at any store in
  `fulfillment.pickup_locations`
- `ship_only` — cannot be picked up in store; do not set a pickup location
- `pickup_only` — cannot be shipped; checkout requires a pickup location from
  `fulfillment.pickup_locations`
- `unavailable` — no sellable stock to ship or pick up; do not offer it

Check the gate before offering checkout. MPP checkout enforces the same rules
on both the preview and the charge call: violations return a 422
`fulfillment_unavailable` error listing each item's reason
(`not_shippable`, `not_available_for_pickup`,
`pickup_unavailable_at_location`) plus the pickup stores that could satisfy
it — re-offer from those instead of retrying.

Set pickup per item with `--line-item <sku>:<qty>:<pickup-location-slug>`, or
for the whole cart with `--pickup-location-slug <slug>`.

## MPP checkout

Preview first, read the total back, request Link approval, then charge with the
SPT returned by link-cli.

- Preview: `buckmason checkout preview --body checkout.json`
- Charge: `buckmason checkout charge --body checkout.json --acknowledged-total-cents <cents> --spt <spt> --confirm`

Both calls enforce the fulfillment rules above — a pickup-only item without a
pickup location (or a ship-only item with one) fails before any payment is
requested.
