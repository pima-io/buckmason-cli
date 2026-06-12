import {Command, Flags} from '@oclif/core'
import open from 'open'
import {buildCheckoutBody} from '../../lib/checkout.js'
import {Client} from '../../lib/client.js'
import {createHostedCheckout, renderHostedCheckoutResponse} from '../../lib/hosted-checkout.js'
import {renderMppError} from '../../lib/mpp.js'
import {printJson} from '../../lib/output.js'

export default class CheckoutHosted extends Command {
  static description = 'Create a PIMA-hosted checkout page when MPP Link CLI payment is unavailable.'

  static flags = {
    body: Flags.string({description: 'JSON file containing the full hosted checkout body'}),
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
    'agent-identity': Flags.string({description: 'X-Agent-Identity header', default: 'buckmason-cli'}),
    'agent-model': Flags.string({description: 'X-Agent-Model header'}),
    open: Flags.boolean({description: 'Open the hosted checkout URL in the default browser'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print full response JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(CheckoutHosted)
    const body = await buildCheckoutBody(flags, {
      emptyMessage: 'Hosted checkout needs --body with line_items or at least one --line-item.',
    })
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const response = await createHostedCheckout(client, body, {
      agentIdentity: flags['agent-identity'],
      agentModel: flags['agent-model'],
      idempotencyKey: flags['idempotency-key'],
    })

    if (flags.open && response.body.hosted_checkout_url) await open(response.body.hosted_checkout_url)

    if (flags.json) {
      this.log(printJson({status: response.status, headers: response.headers, body: response.body}))
      if (response.status >= 400) this.exit(1)
      return
    }

    if (renderMppError((message) => this.log(message), response.body)) this.exit(1)

    this.log(renderHostedCheckoutResponse(response.body))
  }
}
