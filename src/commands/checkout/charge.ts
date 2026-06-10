import {Command, Flags} from '@oclif/core'
import {randomUUID} from 'node:crypto'
import {Client} from '../../lib/client.js'
import {parseCheckoutLineItemSpec} from '../../lib/items.js'
import {readJsonObject} from '../../lib/json-input.js'
import {renderMppError} from '../../lib/mpp.js'
import {printJson, renderKeyValues, renderRecords} from '../../lib/output.js'

export default class CheckoutCharge extends Command {
  static description = 'Complete MPP checkout with a customer-approved Stripe Shared Payment Token.'

  static flags = {
    body: Flags.string({description: 'JSON file containing the full MPP checkout body'}),
    'line-item': Flags.string({multiple: true, description: 'Line item as sku[:qty[:pickup-location-slug]]. Repeat for multiple items.'}),
    buyer: Flags.string({description: 'JSON file for buyer object'}),
    address: Flags.string({description: 'JSON file for fulfillment_address object'}),
    coupon: Flags.string({description: 'Optional coupon code'}),
    credit: Flags.string({multiple: true, description: 'Customer credit code. Repeat for multiple codes.'}),
    'pickup-location-slug': Flags.string({description: 'Optional cart-level pickup location slug'}),
    spt: Flags.string({required: true, description: 'Stripe Shared Payment Token returned by link-cli'}),
    'acknowledged-total-cents': Flags.integer({required: true, description: 'Total cents read back to and approved by the customer'}),
    'idempotency-key': Flags.string({description: 'Idempotency key'}),
    'agent-identity': Flags.string({description: 'X-Agent-Identity header', default: 'buckmason-cli'}),
    'agent-model': Flags.string({description: 'X-Agent-Model header'}),
    'dry-run': Flags.boolean({description: 'Pass dry_run=true to the checkout endpoint'}),
    confirm: Flags.boolean({description: 'Required to submit the charge request'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print full response JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(CheckoutCharge)
    if (!flags.confirm) {
      throw new Error('Refusing to charge without --confirm. Preview the cart, read the total back, and get Link approval first.')
    }

    const body = await buildCheckoutBody(flags)
    body.acknowledged_total_cents = flags['acknowledged-total-cents']

    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const response = await client.mcpPostResponse<Record<string, any>>(
      '/checkout',
      body,
      {dry_run: flags['dry-run'] || undefined},
      {
        // 422 carries structured cart errors (fulfillment_unavailable,
        // total_mismatch, coupon issues) we render instead of raising raw.
        acceptStatuses: [422],
        headers: {
          Authorization: `Payment ${flags.spt}`,
          'Idempotency-Key': flags['idempotency-key'] || randomUUID(),
          'X-Agent-Identity': flags['agent-identity'],
          'X-Agent-Model': flags['agent-model'],
        },
      },
    )

    if (flags.json) {
      this.log(printJson({status: response.status, headers: response.headers, body: response.body}))
      if (response.status >= 400) this.exit(1)
      return
    }

    if (renderMppError((message) => this.log(message), response.body)) this.exit(1)

    const receipt = response.headers['payment-receipt']
    this.log(renderKeyValues({
      state: response.body.state,
      order_code: response.body.order_code,
      payment_receipt: receipt,
      payment_intent_id: response.body.payment_intent_id,
    }, 'table'))
    this.log(renderRecords(response.body.line_items || [], ['sku', 'quantity', 'unit_price', 'pickup_location_name', 'to_pickup'], 'table'))
  }
}

async function buildCheckoutBody(flags: Record<string, any>): Promise<Record<string, any>> {
  const body = flags.body ? await readJsonObject(flags.body) : {}
  if (flags['line-item']?.length) body.line_items = flags['line-item'].map(parseCheckoutLineItemSpec)
  if (flags.buyer) body.buyer = await readJsonObject(flags.buyer)
  if (flags.address) body.fulfillment_address = await readJsonObject(flags.address)
  if (flags.coupon) body.coupon = flags.coupon
  if (flags.credit?.length) body.customer_credit_codes = flags.credit
  if (flags['pickup-location-slug']) body.pickup_location_slug = flags['pickup-location-slug']
  if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
    throw new Error('Checkout charge needs --body with line_items or at least one --line-item.')
  }

  return body
}
