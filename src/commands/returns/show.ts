import {Command, Flags, Args} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {printJson} from '../../lib/output.js'

export default class ReturnsShow extends Command {
  static description = 'Show a created return by id or code.'

  static args = {
    id: Args.string({required: true}),
  }

  static flags = {
    'order-code': Flags.string({description: 'Use the guest order-code path instead of an authorized token'}),
    key: Flags.string({description: 'Override the built-in Buck Mason PIMA public API key.'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ReturnsShow)
    const client = await Client.create({host: flags.host, companySlug: flags.company, key: flags.key})
    const data = await client.apiGet(`/api/customer_returns/${encodeURIComponent(args.id)}`, {
      order_code: flags['order-code'],
    }, {
      authenticated: !flags['order-code'],
    })
    this.log(printJson(data))
  }
}
