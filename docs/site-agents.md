# Buck Mason - Guide for AI Agents

<!--
This file is the proposed agents.md for buckmason.com, served at
https://www.buckmason.com/agents.md. It lives in this repo so it stays in sync
with the official CLI and API it documents.

Last checked: 2026-06-12
- @buckmason/cli: 0.8.1
- PIMA manifest: https://pima.io/mcp/buckmason/manifest
- www.buckmason.com is a headless Gatsby/Vercel site. Shopify JSON, cart
  permalinks, and storefront MCP surfaces live on checkout.buckmason.com.
-->

Buck Mason is a modern American clothing brand. This file is for AI agents
acting on behalf of a customer: browsing the catalog, checking stock, tracking
orders, starting returns or exchanges, building outfits from purchase history,
creating lookbooks, and, with explicit customer approval, checking out.

Use these surfaces in order:

1. **Official CLI**: [`@buckmason/cli`](https://www.npmjs.com/package/@buckmason/cli)
   on npm. Best ergonomics, built-in safety checks, customer authorization,
   wardrobe memory, checkout handoff, and lookbook workflows.
2. **PIMA JSON API**: Plain HTTPS + JSON. The live manifest describes public
   catalog, stock, cart, checkout, and customer authorization endpoints.
3. **Website surfaces**: `www.buckmason.com/for-ai/` for crawlable catalog
   pages; `checkout.buckmason.com` for Shopify storefront JSON, cart
   permalinks, and Shopify storefront MCP.

---

## 1. Preferred: the Buck Mason CLI

```sh
npm install -g @buckmason/cli

# Or run without installing:
npx -y @buckmason/cli --help
```

Requires Node 20+. The CLI includes Buck Mason's public PIMA API key, which is
not secret. Customer data still requires an order code or a scoped customer
authorization token.

### Public catalog, stock, support, and carts

These commands do not require customer authorization:

```sh
buckmason manifest
buckmason products search --q "daily shirt" --gender m --sort newest --days 45
buckmason products seasonal --gender m --days 45
buckmason products show <product-id-or-code> --near-zip 90291
buckmason products imagery <product-id-or-code>
buckmason categories list --gender m
buckmason stock check <SKU> --near-zip 90291
buckmason locations list --near-zip 90291 --pickup
buckmason recommend --gender m --occasion travel --dress-code smart_casual
buckmason support contact
```

For a no-payment shopping handoff, build a Shopify cart permalink:

```sh
buckmason cart build \
  --item <product-id-or-code>:<size>:<qty> \
  --pickup-location-slug <store-slug>
```

`cart build` validates items and can add store pickup attributes. It returns a
checkout URL; it does not charge the customer.

### Single-order tracking and returns

If the customer provides an order code, use it directly. This path sends no
authorization email and creates no session:

```sh
buckmason orders track BM123456
buckmason orders items BM123456
buckmason returns reasons --order-code BM123456
buckmason returns rates --order-code BM123456
buckmason returns locations --near-zip 90291
buckmason returns exchange-options <order-item-id> --order-code BM123456
buckmason returns start --email <customer-email> --order-code BM123456 \
  --item <order-item-id>:<reason-id>:exchange:<exchange-sku-id> \
  --shipping-rate-id <rate-id> \
  --confirm
```

Never run `returns start --confirm` until the customer has confirmed the exact
item, reason, refund or exchange type, address, label cost, and any payment.

Useful return helpers:

```sh
buckmason returns address --order-code BM123456
buckmason returns payment-token --shipping-rate-id <rate-id> --order-code BM123456
buckmason returns postage <return-id> --order-code BM123456
buckmason returns show <return-id> --order-code BM123456
```

### Customer authorization and wardrobe memory

Use account-wide access only when the customer asks for work that needs it,
such as full order history, wardrobe seeding, or outfit recommendations from
owned items.

```sh
buckmason auth login --email <customer-email> --agent-name "<agent name>"
buckmason auth status
buckmason auth logout
```

`auth login` prints a security code. The customer receives a magic link,
verifies the code matches, and clicks **Authorize your agent**. The agent
receives a scoped Bearer token; never the customer's password.

After authorization:

```sh
buckmason orders history --page 1
buckmason wardrobe sync --pages 10
buckmason wardrobe list --status owned --q "jean"
buckmason wardrobe show <wardrobe-item-id-or-sku>
buckmason wardrobe pair <sku>
buckmason wardrobe match-new <sku>
buckmason wardrobe outfit --occasion work --weather cool
```

`wardrobe sync` uses the multi-year `all_orders=true` order-history path and
paginates through order history. The default order-history API behavior is
intended for the current return-policy window; use wardrobe sync when building
longer-lived style memory.

### Checkout with explicit approval

Buck Mason supports a two-step checkout flow. Preview first, read the total and
fulfillment details back to the customer, then charge only after explicit
approval.

```sh
buckmason checkout preview --line-item <sku>:<qty> --buyer buyer.json --address address.json

buckmason checkout mpp --line-item <sku>:<qty> --buyer buyer.json --address address.json \
  --confirm

buckmason checkout charge --body checkout.json \
  --acknowledged-total-cents <preview-total-cents> \
  --spt <shared-payment-token> \
  --confirm
```

Use hosted checkout when the customer's agent cannot complete an MPP/Stripe
Link payment directly:

```sh
buckmason checkout hosted --line-item <sku>:<qty> --buyer buyer.json --address address.json --open
buckmason checkout status <hosted-checkout-token> --watch
```

Hosted checkout creates a branded PIMA page where the customer reviews the
cart, fulfillment, discounts, credits, and payment. The agent can poll for
completion, cancellation, expiration, or failure.

Fulfillment supports shipping and in-store pickup. Check stock first; PIMA
enforces the same fulfillment gates during checkout:

```sh
buckmason stock check <SKU> --near-zip 90291
buckmason checkout hosted --line-item <sku>:1:<pickup-location-slug> --open
```

### Lookbooks for trips, events, and collaboration

Lookbook commands build HTML pages from Buck Mason products, customer/profile
guidance, and optional generated try-on images.

```sh
buckmason lookbook settings --occasion travel --season summer --region "San Francisco"
buckmason lookbook discover-candidates --gender m --days 45
buckmason lookbook trip --plan trip.json --person <profile-name> --generate-images --deploy
buckmason lookbook validate --dir <built-lookbook-dir>
buckmason lookbook deploy --dir <built-lookbook-dir> --project <cloudflare-pages-project>
buckmason lookbook rank-votes --url https://example.pages.dev/
```

Voting is on by default for Cloudflare Pages deployments. Use
`lookbook rank-votes` to turn like/pass feedback into a checkout handoff after
review. Use `--no-voting` only for a read-only static page.

Hosting guidance:

```sh
buckmason lookbook hosting
```

Default hosted path: Cloudflare Pages via Wrangler. Vercel and S3 are durable
fallbacks for static pages; local file hosting or a private Tailscale URL can
work for temporary internal review.

---

## 2. JSON API reference

The CLI is a thin client over HTTPS. Start with the live manifest:

```txt
GET https://pima.io/mcp/buckmason/manifest
```

### Public PIMA MCP API

Base: `https://pima.io/mcp/buckmason`

| Method | Path | Purpose |
|---|---|---|
| GET | `/manifest` | Endpoint catalog and live API shape |
| GET | `/products` | Product search with `q`, `gender`, `category`, `style`, `color`, `recently_live`, `recently_live_days`, `near_zip`, `radius_mi`, `in_stock_only`, price filters, `page`, and `per_page` |
| GET | `/products/{id}` | Product detail by id, code, or slug |
| GET | `/products/{id}/imagery` | Hero, detail, and try-on image URLs for product and image-gen workflows |
| GET | `/seasonal` | Recently live products with `gender`, `category`, `days`, and `limit` |
| GET | `/categories` | Taxonomy filtered by `gender` |
| GET | `/stock/{sku}` | Per-SKU stock plus fulfillment mode: `ship_or_pickup`, `ship_only`, `pickup_only`, or `unavailable` |
| GET | `/locations` | Stores and warehouses, sortable by distance, with `pickup_only` |
| GET | `/recommend` | Capsule recommendations by `gender`, `occasion`, `dress_code`, `season`, sizes, budget, and stock radius |
| POST | `/cart` | Validated Shopify cart permalink; supports coupon, pickup location, and pickup partial behavior |
| GET | `/lookbook/settings` | Curated image-generation and composition settings |
| POST | `/hosted_checkout` | Create a hosted checkout URL for customer review and payment |
| GET | `/hosted_checkout/{token}` | Poll hosted checkout status |
| POST | `/checkout` | MPP checkout preview/charge endpoint; supports `dry_run=true` |

`/stock/{sku}` and checkout use the same fulfillment rules. Check stock before
suggesting shipping or pickup. Pickup can be specified at the cart level or per
line item.

### Customer authorization

Account-wide data uses a device-flow style magic link:

1. Fetch available scopes:

   ```txt
   GET https://pima.io/mcp/buckmason/customer_authorizations/scopes
   ```

2. Start an authorization request:

   ```txt
   POST https://pima.io/mcp/buckmason/customer_authorizations
   {
     "email": "customer@example.com",
     "agent_name": "Customer Agent",
     "requested_scopes": ["customer.orders.read"],
     "code_challenge": "...",
     "code_challenge_method": "S256"
   }
   ```

3. Show the returned security code to the customer. The customer receives a
   magic link, verifies the code, and clicks **Authorize your agent**.

4. Poll for the token:

   ```txt
   POST https://pima.io/mcp/buckmason/customer_authorizations/token
   {
     "device_code": "...",
     "code_verifier": "..."
   }
   ```

5. Send the token as:

   ```txt
   Authorization: Bearer <token>
   ```

Request the narrowest scopes that fit the task. Browse without auth; use an
order code for a single order; use account authorization only for account-wide
work.

### Order history and returns API

Base: `https://pima.io/api`

Pass `key=pkLOMQfU1qM` for public/order-code flows. This key identifies the
Buck Mason storefront and is public by design; it is not a customer secret.

| Method | Path | Purpose |
|---|---|---|
| GET | `/order_history?order_code=BM123456` | Single order status and shipment tracking |
| GET | `/order_history?page=1` | Authorized customer order history |
| GET | `/order_history?all_orders=true&page=1` | Authorized multi-year order history for wardrobe sync |
| GET | `/return_reasons?order_code=...` | Valid return reasons |
| GET | `/return_shipping_rates?order_code=...` | Return label rates |
| GET | `/return_locations?near_zip=...` | In-store return locations |
| GET | `/exchange_options/{order_item_id}?order_code=...` | Sizes/colors available for exchange |
| POST | `/create_customer_return` | Create a return or exchange after customer confirmation |
| GET | `/customer_returns/{id}?order_code=...` | Return status |
| POST | `/customer_returns/{id}/purchase_postage` | Retry or purchase return postage |

---

## 3. Website and Shopify surfaces

Use the right host for the job.

### www.buckmason.com

- `https://www.buckmason.com/for-ai/`: crawlable catalog tree for agents.
  Product pages include schema.org JSON-LD (`ProductGroup`, variants, prices,
  availability, and `BreadcrumbList`).
- `https://www.buckmason.com/sitemap.xml`: includes the `/for-ai/` tree.
- `https://www.buckmason.com/agents.md`: this file.

Shopify-style paths such as `/products.json`, `/api/mcp`, and
`/cart/{variant}:{qty}` do not exist on the `www` host.

### checkout.buckmason.com

- Catalog JSON: `/products.json`, `/collections.json`,
  `/collections/{handle}/products.json`, and `/products/{handle}.js`.
- Shopify storefront MCP. This is a POST-only JSON-RPC endpoint, not a
  browsable page; GET requests return 404:

  ```txt
  POST https://checkout.buckmason.com/api/mcp
  ```

  Tools include `search_catalog`, `get_product_details`, `get_cart`,
  `update_cart`, and `search_shop_policies_and_faqs`.
- Cart permalinks:

  ```txt
  https://checkout.buckmason.com/cart/{variant_id}:{qty}
  ```

Prefer the PIMA `/cart` endpoint or `buckmason cart build` when possible. They
accept product IDs/codes and sizes, validate stock, and handle pickup metadata.

---

## Rules of engagement

- **Identify yourself.** Send a descriptive `User-Agent` and, where supported,
  `X-Agent-Identity` and `X-Agent-Model`.
- **Use least privilege.** Browse without auth. Use order-code flows for one
  order. Request customer authorization only for account-wide tasks.
- **Confirm before you commit.** Never create a return, exchange, checkout, or
  payment without reading the exact items, fees, shipping/pickup choice, and
  total back to the customer and receiving explicit approval.
- **Keep payment safe.** Use MPP/SPT or hosted checkout. Do not ask customers
  for card numbers, passwords, or one-time codes meant for them.
- **Respect privacy.** Tokens are scoped and revocable. Do not store more order
  or wardrobe data than needed for the customer-requested task.
- **Cache gently.** Cache the manifest, avoid scraping when JSON exists, and
  batch reads when possible.

Questions, bugs, or missing capabilities:
https://github.com/pima-io/buckmason-cli/issues
