import {Command, Flags} from '@oclif/core'
import {outfitSuggestion, readWardrobe} from '../../lib/wardrobe.js'
import {printJson, renderRecords, type OutputFormat} from '../../lib/output.js'

export default class WardrobeOutfit extends Command {
  static description = 'Suggest a simple outfit from owned Buck Mason wardrobe items.'

  static flags = {
    occasion: Flags.string({description: 'Occasion, for example work, travel, dinner'}),
    weather: Flags.string({description: 'Weather hint, for example hot, cool, rain'}),
    cache: Flags.string({description: 'Wardrobe cache path'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(WardrobeOutfit)
    const outfit = outfitSuggestion((await readWardrobe(flags.cache)).items, {occasion: flags.occasion, weather: flags.weather})
    if (flags.output === 'json') this.log(printJson(outfit))
    else this.log(renderRecords(outfit, ['product', 'color', 'size', 'sku', 'category', 'tags'], flags.output as OutputFormat))
  }
}
