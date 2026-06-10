import {Command, Flags} from '@oclif/core'
import {randomUUID} from 'node:crypto'
import {Client} from '../../lib/client.js'
import {parseCheckoutLineItemSpec} from '../../lib/items.js'
import {readJsonObject} from '../../lib/json-input.js'
import {printJson, renderKeyValues, renderRecords} from '../../lib/output.js'

export default class CheckoutPreview extends Command {
  static description = 'Preview an MPP checkout cart and payment challenge without charging.'

  static flags = {
    body: Flags.string({description: 'JSON file containing the full MPP checkout body'}),
    'line-item': Flags.string({multiple: true, description: 'Line item as sku[:qty[:pickup-location-slug]]. Repeat for multiple items.'}),
    buyer: Flags.string({description: 'JSON file for buyer object'}),
    address: Flags.string({description: 'JSON file for fulfillment_address object'}),
    coupon: Flags.string({description: 'Optional coupon code'}),
    credit: Flags.string({multiple: true, description: 'Customer credit code. Repeat for multiple codes.'}),
    'pickup-location-slug': Flags.string({description: 'Optional cart-level pickup location slug'}),
    'idempotency-key': Flags.string({description: 'Idempotency key'}),
    'dry-run': Flags.boolean({description: 'Pass dry_run=true to the checkout endpoint'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print full response JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(CheckoutPreview)
    const body = await buildCheckoutBody(flags)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const response = await client.mcpPostResponse<Record<string, any>>(
      '/checkout',
      body,
      {dry_run: flags['dry-run'] || undefined},
      {
        acceptStatuses: [402],
        headers: {'Idempotency-Key': flags['idempotency-key'] || randomUUID()},
      },
    )

    if (flags.json) {
      this.log(printJson({status: response.status, headers: response.headers, body: response.body}))
      return
    }

    this.log(`Status: ${response.status}`)
    if (response.headers['www-authenticate']) this.log(`WWW-Authenticate: ${response.headers['www-authenticate']}`)
    renderCheckoutPreview(this, response.body)
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
    throw new Error('Checkout preview needs --body with line_items or at least one --line-item.')
  }

  return body
}

function renderCheckoutPreview(command: Command, body: Record<string, any>): void {
  const totals = body.totals || {}
  command.log(renderKeyValues({
    subtotal: totals.subtotal,
    discount: totals.discount,
    shipping: totals.shipping,
    tax: totals.tax,
    credit_applied: totals.credit_applied,
    total: totals.total,
    charge: totals.charge,
  }, 'table'))

  command.log(renderRecords(body.line_items || [], ['sku', 'quantity', 'unit_price', 'pickup_location_name', 'to_pickup'], 'table'))
  if (body.suggested_context) command.log(`Suggested Link context: ${body.suggested_context}`)
}
