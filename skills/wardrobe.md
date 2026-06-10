# Buck Mason Wardrobe Skill

Use this skill when the customer asks what they own, what goes with what, what
to wear today, or whether a new Buck Mason item would work with an owned piece.

## First step

If the local wardrobe may be stale, sync from authorized order history:

```bash
buckmason wardrobe sync
```

This requires the customer-agent token plus `BUCKMASON_PIMA_KEY`. The cache is
local by default at `~/.buckmason/wardrobe.json` and contains product/order item
facts only.

## Example questions

Customer: "What should I wear today?"

```bash
buckmason wardrobe outfit --occasion casual --weather cool
```

Use weather/calendar context if the agent has it. Prefer `owned` items and avoid
items marked `not_in_hand` or `returned_or_exchanged`.

Customer: "What goes with these jeans?"

```bash
buckmason wardrobe list --category jean
buckmason wardrobe pair <sku-or-product-name>
```

Start with owned pieces before recommending anything new. Explain the pairings
in plain language: role, color compatibility, and season/formality fit.

Customer: "Does Buck Mason have anything new that would go with my jeans?"

```bash
buckmason wardrobe match-new <sku-or-product-name> --days 45 --gender m
```

This checks recent catalog items, skips likely duplicates already in the
wardrobe cache, and ranks by compatibility with the owned anchor item. Before
checkout, still run live product/stock checks:

```bash
buckmason products show <product-id> --near-zip <zip>
buckmason stock check <sku> --near-zip <zip>
```

Customer: "Do I already have something like this?"

```bash
buckmason wardrobe list --q "<product/color/category terms>"
```

Use the result to avoid duplicate recommendations unless the customer asked for
a replacement or another color.

## Safety

Wardrobe memory is advisory. It is derived from order history and shipment or
return state, but ambiguous old records may be marked `maybe_owned`. Say that
clearly when using those items. Never treat a wardrobe suggestion as purchase
approval; confirm item, size, fulfillment method, coupon/credit, live total, and
Link approval before checkout.
