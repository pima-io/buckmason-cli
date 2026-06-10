# Buck Mason Customer Service Skill

Use this skill for order history, shipment tracking, and return starts.

## Default path: order code

Use the order code for single-order tracking and most returns. It is the
lowest-friction path: no email, no inbox access, and no customer-agent token.

```bash
buckmason orders track <order-code>
buckmason orders history --order-code <order-code>
buckmason orders items <order-code>
buckmason returns reasons --order-code <order-code>
buckmason returns rates --order-code <order-code>
buckmason returns locations --near-zip <zip>
buckmason returns show <return-id-or-code> --order-code <order-code>
buckmason returns postage <return-id-or-code> --order-code <order-code>
buckmason returns exchange-options <order-item-id> --order-code <order-code>
buckmason returns start --order-code <order-code> --email <email> --item <order-item-id>:<reason-id>:original --confirm
buckmason returns start --order-code <order-code> --email <email> --item <order-item-id>:<reason-id>:exchange:<sku-id> --confirm
```

## Account-wide authorization

Use auth only when the customer explicitly wants account-wide history. Run
`buckmason auth login --email <customer-email>`. PIMA sends the customer a
magic link. The customer approves the agent from PIMA, and the CLI receives a
scoped Bearer token.

## Commands

- `buckmason orders history`
  Lists the customer's recent orders with account authorization.

- `buckmason orders track <order-code> --account`
  Searches account history instead of using the guest order-code path.

- `buckmason returns reasons`
  Lists return reasons with account authorization.

- `buckmason returns rates`
  Lists return shipping rates with account authorization.

- `buckmason returns address`
  Shows the saved customer address PIMA will use for return labels.

- `buckmason returns payment-token --shipping-rate-id <id>`
  Creates the Stripe client secret for a paid exchange shipping rate.

- `buckmason returns start --email <email> --item <order-item-id>:<reason-id>:<type> --confirm`
  Creates a return. Repeat `--item` for multi-item returns, or pass
  `--items-file` with an RMS-shaped `items_attributes` array. Only use after
  explicit customer confirmation.

- `buckmason returns start --item <order-item-id>:<reason-id>:exchange:<sku-id> ... --confirm`
  Creates an exchange return item using the SKU id selected from
  `returns exchange-options`.

RMS API commands require `BUCKMASON_PIMA_KEY` or `--key`.
