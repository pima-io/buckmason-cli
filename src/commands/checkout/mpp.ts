import {Command, Flags} from '@oclif/core'
import {execFile} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {promisify} from 'node:util'
import {buildCheckoutBody} from '../../lib/checkout.js'
import {Client} from '../../lib/client.js'
import {
  buildLinkSpendRequestInput,
  extractSharedPaymentToken,
  latestSpendRequest,
} from '../../lib/mpp-checkout.js'
import {renderMppError} from '../../lib/mpp.js'
import {formatMoney, printJson, renderKeyValues, renderRecords} from '../../lib/output.js'

const execFileAsync = promisify(execFile)

export default class CheckoutMpp extends Command {
  static description = 'Preview, request Link approval, and complete an MPP checkout.'

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
    'payment-method-id': Flags.string({required: true, description: 'Link payment method ID from `link-cli payment-methods list`'}),
    'link-cli': Flags.string({description: 'Link CLI executable', default: 'link-cli'}),
    'approval-interval': Flags.integer({description: 'Seconds between Link approval polls', default: 2}),
    'approval-max-attempts': Flags.integer({description: 'Maximum Link approval poll attempts', default: 150}),
    'acknowledged-total-cents': Flags.integer({description: 'Optional guardrail total cents; must match the preview charge total'}),
    'idempotency-key': Flags.string({description: 'Idempotency key'}),
    'agent-identity': Flags.string({description: 'X-Agent-Identity header', default: 'buckmason-cli'}),
    'agent-model': Flags.string({description: 'X-Agent-Model header'}),
    'dry-run': Flags.boolean({description: 'Pass dry_run=true to the preview and charge endpoint'}),
    confirm: Flags.boolean({description: 'Required after reading the total to the customer and before requesting Link approval'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print full response JSON without exposing the shared payment token'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(CheckoutMpp)
    if (!flags.confirm) {
      throw new Error('Refusing to request Link approval without --confirm. Preview the cart and read the total back to the customer first.')
    }

    const body = await buildCheckoutBody(flags, {
      emptyMessage: 'MPP checkout needs --body with line_items or at least one --line-item.',
    })
    const idempotencyKey = flags['idempotency-key'] || randomUUID()
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})

    const preview = await client.mcpPostResponse<Record<string, any>>(
      '/checkout',
      body,
      {dry_run: flags['dry-run'] || undefined},
      {
        acceptStatuses: [402, 422],
        headers: {'Idempotency-Key': idempotencyKey},
      },
    )
    if (renderMppError((message) => this.log(message), preview.body)) this.exit(1)
    if (preview.status !== 402) throw new Error(`Expected MPP checkout preview to return HTTP 402, got ${preview.status}.`)

    const linkInput = buildLinkSpendRequestInput(preview.body, preview.headers['www-authenticate'])
    if (flags['acknowledged-total-cents'] != null && flags['acknowledged-total-cents'] !== linkInput.amountCents) {
      throw new Error(`Acknowledged total ${flags['acknowledged-total-cents']} does not match preview charge ${linkInput.amountCents}.`)
    }

    if (!flags.json) {
      this.log(renderKeyValues({
        charge: formatMoney(linkInput.amountCents),
        charge_cents: linkInput.amountCents,
        currency: linkInput.currency,
        network_id: linkInput.networkId,
      }, 'table'))
      this.log(renderRecords(preview.body.line_items || [], ['sku', 'quantity', 'unit_price', 'pickup_location_name', 'to_pickup'], 'table'))
      this.log('Requesting Link approval...')
    }

    const created = latestSpendRequest(await runLinkJson(flags['link-cli'], buildCreateSpendRequestArgs(flags['payment-method-id'], linkInput)))
    if (!created.id) throw new Error('link-cli did not return a spend request id.')
    if (!flags.json && created.approval_url) this.log(`Approve in Link: ${created.approval_url}`)

    const approved = latestSpendRequest(await runLinkJson(flags['link-cli'], [
      'spend-request',
      'retrieve',
      String(created.id),
      '--interval',
      String(flags['approval-interval']),
      '--max-attempts',
      String(flags['approval-max-attempts']),
      '--include',
      'shared_payment_token',
      '--format',
      'json',
    ]))
    if (approved.status !== 'approved') throw new Error(`Link spend request ${approved.id || created.id} ended with status ${approved.status}.`)

    const chargeBody = {...body, acknowledged_total_cents: linkInput.amountCents}
    const charge = await client.mcpPostResponse<Record<string, any>>(
      '/checkout',
      chargeBody,
      {dry_run: flags['dry-run'] || undefined},
      {
        acceptStatuses: [402, 422],
        headers: {
          Authorization: `Payment ${extractSharedPaymentToken(approved)}`,
          'Idempotency-Key': idempotencyKey,
          'X-Agent-Identity': flags['agent-identity'],
          'X-Agent-Model': flags['agent-model'],
        },
      },
    )

    if (flags.json) {
      this.log(printJson({
        preview: {status: preview.status, body: preview.body},
        spend_request: {id: approved.id || created.id, status: approved.status},
        charge: {status: charge.status, headers: charge.headers, body: charge.body},
      }))
      if (charge.status >= 400) this.exit(1)
      return
    }

    if (renderMppError((message) => this.log(message), charge.body)) this.exit(1)
    this.log(renderKeyValues({
      state: charge.body.state,
      order_code: charge.body.order_code,
      payment_receipt: charge.headers['payment-receipt'],
      payment_intent_id: charge.body.payment_intent_id,
    }, 'table'))
    this.log(renderRecords(charge.body.line_items || [], ['sku', 'quantity', 'unit_price', 'pickup_location_name', 'to_pickup'], 'table'))
  }
}

function buildCreateSpendRequestArgs(paymentMethodId: string, input: ReturnType<typeof buildLinkSpendRequestInput>): string[] {
  const args = [
    'spend-request',
    'create',
    '--payment-method-id',
    paymentMethodId,
    '--credential-type',
    'shared_payment_token',
    '--network-id',
    input.networkId,
    '--amount',
    String(input.amountCents),
    '--currency',
    input.currency,
    '--context',
    input.context,
  ]

  for (const lineItem of input.lineItems) args.push('--line-item', lineItem)
  for (const total of input.totals) args.push('--total', total)
  args.push('--request-approval', '--format', 'json')
  return args
}

async function runLinkJson(linkCli: string, args: string[]): Promise<Record<string, any> | Array<Record<string, any>>> {
  try {
    const {stdout} = await execFileAsync(linkCli, args, {maxBuffer: 1024 * 1024 * 10})
    return JSON.parse(stdout)
  } catch (error) {
    const err = error as {stdout?: string; stderr?: string; message?: string}
    const output = err.stdout || err.stderr
    if (output) {
      const trimmed = output.trim()
      let parsed: any
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        throw new Error(trimmed)
      }

      throw new Error(parsed.message || parsed.error || JSON.stringify(parsed))
    }

    throw new Error(err.message || 'link-cli failed.')
  }
}
