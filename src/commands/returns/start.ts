import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {readJsonObject, readJsonValue} from '../../lib/json-input.js'
import {printJson} from '../../lib/output.js'
import {
  buildReturnItem,
  extractReturnItemsFromJson,
  parseReturnItemSpec,
  type ReturnType,
} from '../../lib/returns.js'

export default class ReturnsStart extends Command {
  static description = 'Create a Buck Mason return after the agent has confirmed item, reason, address, and shipping rate.'

  static flags = {
    email: Flags.string({required: true, description: 'Customer email for the return'}),
    item: Flags.string({
      multiple: true,
      description: 'Repeatable item spec: order_item_id:reason_id:return_type[:exchange_sku_id]',
    }),
    'items-file': Flags.string({description: 'JSON file containing items_attributes, or an array of return item objects'}),
    'order-item-id': Flags.integer({description: 'Order item id to return. Kept for single-item scripts.'}),
    'reason-id': Flags.integer({description: 'Return reason id. Kept for single-item scripts.'}),
    'shipping-rate-id': Flags.integer({description: 'Return shipping rate id'}),
    'address-id': Flags.integer({description: 'Saved customer address id'}),
    address: Flags.string({description: 'JSON file for customer_address_attributes when no saved address is used'}),
    'payment-intent-id': Flags.string({description: 'Stripe payment intent id for a paid exchange shipping rate'}),
    'order-code': Flags.string({description: 'Use the guest order-code path instead of an authorized token'}),
    'exchange-sku-id': Flags.integer({description: 'Exchange SKU id selected from returns exchange-options'}),
    type: Flags.string({description: 'Return type', options: ['original', 'exchange', 'credit']}),
    confirm: Flags.boolean({description: 'Required to actually create the return'}),
    key: Flags.string({description: 'PIMA public API key. Or set BUCKMASON_PIMA_KEY.'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ReturnsStart)
    if (!flags.confirm) {
      throw new Error('Refusing to create a return without --confirm. Read the selected item/reason/rate back to the customer first.')
    }

    const client = await Client.create({host: flags.host, companySlug: flags.company, key: flags.key})
    const items = await returnItemsFromFlags(flags)
    const customer_return: Record<string, any> = {
      email: flags.email,
      shipping_rate_id: flags['shipping-rate-id'],
      customer_address_id: flags['address-id'],
      payment_intent_id: flags['payment-intent-id'],
      items_attributes: items,
    }
    if (flags.address) customer_return.customer_address_attributes = await readJsonObject(flags.address)

    const data = await client.apiPost('/api/create_customer_return', {
      customer_return,
      order_code: flags['order-code'],
    }, {
      authenticated: !flags['order-code'],
    })
    this.log(printJson(data))
  }
}

async function returnItemsFromFlags(flags: Record<string, any>): Promise<Record<string, unknown>[]> {
  const items = [
    ...((flags.item || []) as string[]).map(parseReturnItemSpec).map(buildReturnItem),
    ...(flags['items-file'] ? extractReturnItemsFromJson(await readJsonValue(flags['items-file'])) : []),
  ]

  if (flags['order-item-id'] || flags['reason-id'] || flags.type || flags['exchange-sku-id']) {
    if (!flags['order-item-id'] || !flags['reason-id']) {
      throw new Error('Single-item returns require both --order-item-id and --reason-id.')
    }

    items.push(buildReturnItem({
      orderItemId: flags['order-item-id'],
      reasonId: flags['reason-id'],
      type: flags.type as ReturnType | undefined,
      exchangeSkuId: flags['exchange-sku-id'],
    }))
  }

  if (!items.length) {
    throw new Error('Provide at least one --item, --items-file, or --order-item-id/--reason-id pair.')
  }

  return items
}
