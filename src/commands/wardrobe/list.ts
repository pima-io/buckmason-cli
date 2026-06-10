import {Command, Flags} from '@oclif/core'
import {readWardrobe, searchWardrobe} from '../../lib/wardrobe.js'
import {printJson, renderRecords, type OutputFormat} from '../../lib/output.js'

export default class WardrobeList extends Command {
  static description = 'List items from the local Buck Mason wardrobe cache.'

  static flags = {
    q: Flags.string({description: 'Search wardrobe text'}),
    category: Flags.string({description: 'Category or tag filter'}),
    status: Flags.string({options: ['owned', 'maybe_owned', 'not_in_hand', 'returned_or_exchanged'], description: 'Ownership status'}),
    color: Flags.string({description: 'Color filter'}),
    cache: Flags.string({description: 'Wardrobe cache path'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(WardrobeList)
    const cache = await readWardrobe(flags.cache)
    const items = searchWardrobe(cache.items, flags.q, {category: flags.category, status: flags.status, color: flags.color})
    if (flags.output === 'json') this.log(printJson(items))
    else this.log(renderRecords(items, ['product', 'color', 'size', 'sku', 'category', 'status', 'fulfillment'], flags.output as OutputFormat))
  }
}
