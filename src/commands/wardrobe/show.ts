import {Args, Command, Flags} from '@oclif/core'
import {findWardrobeItem, readWardrobe} from '../../lib/wardrobe.js'
import {printJson, renderKeyValues} from '../../lib/output.js'

export default class WardrobeShow extends Command {
  static description = 'Show one item from the local wardrobe cache.'

  static args = {
    item: Args.string({required: true, description: 'SKU, cache id, or product-name text'}),
  }

  static flags = {
    cache: Flags.string({description: 'Wardrobe cache path'}),
    json: Flags.boolean({description: 'Print JSON'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(WardrobeShow)
    const item = findWardrobeItem((await readWardrobe(flags.cache)).items, args.item)
    if (!item) throw new Error(`No wardrobe item matched "${args.item}". Run wardrobe list first.`)
    this.log(flags.json ? printJson(item) : renderKeyValues(item as any, 'table'))
  }
}
