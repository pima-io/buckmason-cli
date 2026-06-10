import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {printJson, renderKeyValues, type OutputFormat} from '../../lib/output.js'

export default class ReturnsPaymentToken extends Command {
  static description = 'Create a Stripe payment token for a paid exchange shipping rate.'

  static flags = {
    'shipping-rate-id': Flags.integer({required: true, description: 'Paid return shipping rate id'}),
    'order-code': Flags.string({description: 'Use the guest order-code path instead of an authorized token'}),
    key: Flags.string({description: 'PIMA public API key. Or set BUCKMASON_PIMA_KEY.'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ReturnsPaymentToken)
    const client = await Client.create({host: flags.host, companySlug: flags.company, key: flags.key})
    const data = await client.apiPost<Record<string, unknown>>('/api/shipping_payment_token', {
      shipping_rate_id: flags['shipping-rate-id'],
      order_code: flags['order-code'],
    }, {
      authenticated: !flags['order-code'],
    })

    if (flags.output === 'json') {
      this.log(printJson(data))
      return
    }

    this.log(renderKeyValues(data || {}, flags.output as OutputFormat))
  }
}
