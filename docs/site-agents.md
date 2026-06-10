# Buck Mason — Guide for AI Agents

<!--
This file is the proposed agents.md for buckmason.com (served at
https://www.buckmason.com/agents.md). It lives in this repo so it stays in
sync with the CLI it documents.

Endpoints in section 3 verified live on 2026-06-10:
- www.buckmason.com is headless (Gatsby on Vercel) — Shopify paths 404 there.
- Shopify surfaces work on checkout.buckmason.com / buck-mason-usa.myshopify.com:
  /products.json, /collections/{handle}/products.json, /products/{handle}.js,
  POST /api/mcp (storefront MCP, 5 tools), /cart/{variant}:{qty} permalinks.
- www.buckmason.com/for-ai/* is the crawlable AI tree with JSON-LD.
-->

Buck Mason is a modern American clothing brand. This file is for AI agents
acting on behalf of a customer — shopping the catalog, checking stock near the
customer, tracking orders, starting returns or exchanges, building outfits from
what the customer already owns, and (with explicit approval) checking out.

There are three ways to work with us, in order of preference:

1. **The official CLI** — [`@buckmason/cli`](https://www.npmjs.com/package/@buckmason/cli)
   on npm. Best ergonomics, built-in agent guidance, safe defaults.
2. **The raw JSON API** — everything the CLI does is plain HTTPS + JSON. The
   API self-describes at a manifest endpoint. Use this if you can't run Node
   or the customer prefers not to install anything.
3. **The website** — buckmason.com is a standard Shopify storefront, so
   standard storefront JSON endpoints and cart permalinks work too.

---

## 1. Preferred: the Buck Mason CLI

```sh
npm install -g @buckmason/cli   # or, with no install at all:
npx -y @buckmason/cli --help
```

Requires Node 20+. If you can run `npx`, you don't need to install anything
globally — every example below works with `npx -y @buckmason/cli <args>`.

### Public commands (no auth, no account)

```sh
buckmason manifest                                      # discover the full API surface
buckmason products search --q "daily shirt" --gender m
buckmason products seasonal --gender m --days 45
buckmason products show <product-id> --near-zip 90291
buckmason products imagery <product-id>
buckmason categories list --gender m
buckmason stock check <SKU> --near-zip 90291
buckmason locations list --near-zip 90291 --pickup
buckmason recommend --gender m --occasion travel --dress-code smart_casual
buckmason cart build --item <product-id>:<size>:<qty>   # returns a checkout URL
```

### Single-order tracking and returns (order code, no token)

If the customer has their order code (e.g. `BM123456`), use it directly. This
path sends no email and creates no session:

```sh
buckmason orders track BM123456
buckmason orders items BM123456                          # returnability per item
buckmason returns reasons --order-code BM123456
buckmason returns rates --order-code BM123456
buckmason returns exchange-options <order-item-id> --order-code BM123456
buckmason returns start --order-code BM123456 \
  --item <order-item-id>:<reason-id>:<original|exchange[:exchange-sku-id]> --confirm
```

### Account-wide access (customer authorization)

Only when the customer asks for account-wide work (full order history,
wardrobe seeding). `buckmason auth login --email <customer-email>` prints a
security code; the customer receives an email, verifies the code matches, and
clicks **Authorize your agent**. You receive a scoped Bearer token — never the
customer's password. Then:

```sh
buckmason orders history
buckmason wardrobe sync
buckmason wardrobe pair <sku>            # "what goes with these jeans?"
buckmason wardrobe match-new <sku>       # "anything new that works with them?"
buckmason wardrobe outfit --occasion work --weather cool
```

---

## 2. No CLI? Use the JSON API directly

The CLI is a thin client — every command above is a plain HTTPS request. No
SDK, no special transport. (The `/mcp/` path prefix is historical naming;
these are ordinary REST + JSON endpoints.)

**Start here — the manifest describes every endpoint, parameter, and shape:**

```
GET https://pima.io/mcp/buckmason/manifest
```

### Public catalog (no auth)

Base: `https://pima.io/mcp/buckmason`

| Method | Path | Purpose |
|---|---|---|
| GET | `/manifest` | Self-describing endpoint catalog — fetch this first |
| GET | `/products?q=&gender=` | Search the catalog |
| GET | `/products/{id}?near_zip=` | Product detail with nearby availability |
| GET | `/products/{id}/imagery` | Product images |
| GET | `/seasonal?gender=&days=` | New and seasonal items |
| GET | `/categories?gender=` | Taxonomy |
| GET | `/stock/{sku}?near_zip=` | Online + nearby-store stock for a SKU |
| GET | `/locations?near_zip=&pickup=` | Stores and pickup locations |
| GET | `/recommend?gender=&occasion=&dress_code=` | Capsule recommendations |
| POST | `/cart` | Build a validated cart → returns `checkout_url` |

### Orders and returns (order code + brand-public key)

Base: `https://pima.io/api`, with `key=pkLOMQfU1qM` (this key is public by
design — it identifies the Buck Mason storefront, not a customer; customer
data still requires an order code or an authorized token).

| Method | Path | Purpose |
|---|---|---|
| GET | `/order_history?order_code=` | Order status + shipment tracking |
| GET | `/return_reasons?order_code=` | Valid return reasons |
| GET | `/return_shipping_rates?order_code=` | Return label rates |
| GET | `/return_locations?near_zip=` | In-store return drop-off options |
| GET | `/exchange_options/{order_item_id}?order_code=` | Sizes/colors available for exchange |
| POST | `/create_customer_return` | Create the return/exchange (confirm with the customer first) |
| GET | `/customer_returns/{id}?order_code=` | Return status |
| POST | `/customer_returns/{id}/purchase_postage` | Retry label purchase |

### Account authorization (device-flow style)

1. `POST https://pima.io/mcp/buckmason/customer_authorizations` with
   `{email, agent_name, requested_scopes, code_challenge, code_challenge_method: "S256"}`
   → returns `device_code`, `user_code` (the security code), and polling interval.
2. Tell the customer the security code. They receive a magic-link email and
   click **Authorize your agent** after checking the code matches.
3. Poll `POST .../customer_authorizations/token` with
   `{device_code, code_verifier}` until you receive a scoped Bearer token.
4. Send it as `Authorization: Bearer <token>` to the `/api/*` endpoints
   (e.g. `GET /api/order_history?all_orders=true`).

Scopes follow `customer.<area>.<read|create>` — request the narrowest set
that does the job (e.g. `customer.orders.read` alone for history questions).

---

## 3. No HTTP client with custom headers? The website still works

The main site at `www.buckmason.com` is a headless frontend; the Shopify
store behind it is served at `checkout.buckmason.com` (alias:
`buck-mason-usa.myshopify.com`). Use the right domain for each surface:

### On www.buckmason.com (browse and crawl)

- **`https://www.buckmason.com/for-ai/`** — a dedicated, crawl-friendly tree
  built for AI agents. It mirrors the full catalog taxonomy
  (`/for-ai/mens/outerwear/coats/chore-coats/felted-chore-coat`, …) and each
  page carries schema.org JSON-LD (`ProductGroup` with per-color variants,
  prices, and availability, plus `BreadcrumbList`). Start here if you're
  working from page content alone.
- `https://www.buckmason.com/sitemap.xml` enumerates everything, including
  the `/for-ai/` tree.
- Note: Shopify-style paths (`/products.json`, `/api/mcp`, `/cart/{id}:{qty}`)
  do **not** exist on the www domain.

### On checkout.buckmason.com (Shopify storefront surfaces)

- Catalog JSON: `https://checkout.buckmason.com/products.json`,
  `/collections.json`, `/collections/{handle}/products.json`, and
  `/products/{handle}.js`.
- Shopify's storefront MCP endpoint for MCP-capable agents:
  `POST https://checkout.buckmason.com/api/mcp` — tools include
  `search_catalog`, `get_product_details`, `get_cart`, `update_cart`, and
  `search_shop_policies_and_faqs`.
- Cart permalinks: `https://checkout.buckmason.com/cart/{variant_id}:{qty}`
  redirects straight into a live checkout. Prefer `POST /cart` above when you
  can — it validates live stock and sizes and handles coupons and store
  pickup, and takes product IDs + sizes instead of Shopify variant IDs.

---

## Rules of engagement

- **Identify yourself.** Send a descriptive `User-Agent` that names your agent.
- **Least privilege.** Browse without auth. Use the order-code path for
  single-order work. Request account authorization only when the customer
  explicitly wants account-wide access, with minimal scopes.
- **Confirm before you commit.** Never create a return or exchange, and never
  charge a payment, without reading the exact items, fees, and total back to
  the customer and receiving explicit approval. Checkout is two-step by
  design: preview, then charge with the acknowledged total.
- **Privacy.** Tokens are scoped and revocable. The API never returns payment
  card data; don't ask customers for card numbers, account passwords, or
  one-time codes meant for them.
- **Be gentle.** Cache the manifest (it changes rarely), batch your reads, and
  prefer the JSON endpoints over scraping HTML.

Questions, bugs, or missing capabilities: open an issue at
https://github.com/pima-io/buckmason-cli/issues
