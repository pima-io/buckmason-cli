import {Args, Command, Flags} from '@oclif/core'
import {setTimeout as delay} from 'node:timers/promises'
import {Client} from '../../lib/client.js'
import {printJson, renderKeyValues} from '../../lib/output.js'

export default class CheckoutStatus extends Command {
  static description = 'Poll a PIMA-hosted checkout for completion, cancellation, expiration, or failure.'

  static args = {
    token: Args.string({required: true, description: 'Hosted checkout token'}),
  }

  static flags = {
    watch: Flags.boolean({char: 'w', description: 'Poll until the checkout reaches a terminal status'}),
    interval: Flags.integer({description: 'Polling interval in seconds', default: 3}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print full response JSON'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(CheckoutStatus)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const intervalMs = Math.max(1, flags.interval) * 1000

    for (;;) {
      const status = await client.mcpGet<Record<string, any>>(`/hosted_checkout/${encodeURIComponent(args.token)}`)
      if (flags.json) {
        this.log(printJson(status))
      } else {
        this.log(renderHostedCheckoutStatus(status))
      }

      if (!flags.watch || status.terminal) break
      await delay(status.poll_after_seconds ? status.poll_after_seconds * 1000 : intervalMs)
    }
  }
}

function renderHostedCheckoutStatus(status: Record<string, any>): string {
  return renderKeyValues({
    token: status.token,
    status: status.status,
    terminal: status.terminal,
    completed: status.completed,
    canceled: status.canceled,
    expired: status.expired,
    failed: status.failed,
    hosted_checkout_url: status.hosted_checkout_url,
    charge: status.totals?.charge,
    payment_intent_id: status.payment?.payment_intent_id,
    payment_amount_cents: status.payment?.amount_cents,
    order_code: status.order?.code,
    order_status: status.order?.status,
    error_message: status.error_message,
    expires_at: status.expires_at,
    completed_at: status.completed_at,
  }, 'table')
}
