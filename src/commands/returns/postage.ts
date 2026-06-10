import {Args, Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {readJsonObject} from '../../lib/json-input.js'
import {printJson, renderKeyValues, type OutputFormat} from '../../lib/output.js'

export default class ReturnsPostage extends Command {
  static description = 'Purchase or retry return postage and show label or QR code URLs.'

  static args = {
    id: Args.string({required: true, description: 'Customer return id or code'}),
  }

  static flags = {
    address: Flags.string({description: 'JSON file with replacement customer_address_attributes for label retry'}),
    'order-code': Flags.string({description: 'Use the guest order-code path instead of an authorized token'}),
    key: Flags.string({description: 'PIMA public API key. Or set BUCKMASON_PIMA_KEY.'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ReturnsPostage)
    const customerReturn: Record<string, any> = {}
    if (flags.address) customerReturn.customer_address_attributes = await readJsonObject(flags.address)

    const client = await Client.create({host: flags.host, companySlug: flags.company, key: flags.key})
    const data = await client.apiPost<Record<string, unknown>>(
      `/api/customer_returns/${encodeURIComponent(args.id)}/purchase_postage`,
      {
        customer_return: customerReturn,
        order_code: flags['order-code'],
      },
      {
        authenticated: !flags['order-code'],
      },
    )

    if (flags.output === 'json') {
      this.log(printJson(data))
      return
    }

    this.log(renderKeyValues(labelSummary(data), flags.output as OutputFormat))
  }
}

function labelSummary(data: Record<string, any>): Record<string, unknown> {
  return {
    id: data.id,
    code: data.code,
    status: data.status,
    label_url: data.label_url,
    qr_label_url: data.qr_label_url,
    tracking_code: data.tracking_code,
    tracking_url: data.tracking_url,
  }
}
