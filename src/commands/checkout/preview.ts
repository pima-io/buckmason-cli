import {Command, Flags} from '@oclif/core'
import {randomUUID} from 'node:crypto'
import {buildCheckoutBody} from '../../lib/checkout.js'
import {Client} from '../../lib/client.js'
import {renderMppError} from '../../lib/mpp.js'
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
    'pickup-location-id': Flags.integer({description: 'Optional cart-level pickup location id'}),
    'shipping-rate-code': Flags.string({description: 'Optional shipping rate code'}),
    'shipping-rate-id': Flags.integer({description: 'Optional shipping rate id'}),
    'shipping-rate-name': Flags.string({description: 'Optional shipping rate name'}),
    'idempotency-key': Flags.string({description: 'Idempotency key'}),
    'dry-run': Flags.boolean({description: 'Pass dry_run=true to the checkout endpoint'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print full response JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(CheckoutPreview)
    const body = await buildCheckoutBody(flags, {
      emptyMessage: 'Checkout preview needs --body with line_items or at least one --line-item.',
    })
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const response = await client.mcpPostResponse<Record<string, any>>(
      '/checkout',
      body,
      {dry_run: flags['dry-run'] || undefined},
      {
        // 402 is the expected MPP challenge; 422 carries structured cart
        // errors (fulfillment_unavailable, coupon issues) worth rendering.
        acceptStatuses: [402, 422],
        headers: {'Idempotency-Key': flags['idempotency-key'] || randomUUID()},
      },
    )

    if (flags.json) {
      this.log(printJson({status: response.status, headers: response.headers, body: response.body}))
      if (response.status === 422) this.exit(1)
      return
    }

    this.log(`Status: ${response.status}`)
    if (renderMppError((message) => this.log(message), response.body)) this.exit(1)
    if (response.headers['www-authenticate']) this.log(`WWW-Authenticate: ${response.headers['www-authenticate']}`)
    renderCheckoutPreview(this, response.body)
  }
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
