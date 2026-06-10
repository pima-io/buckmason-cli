import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {printJson, renderRecords} from '../../lib/output.js'

export default class LookbookSettings extends Command {
  static description = 'Fetch curated lookbook settings and image-generation prompt guidance from PIMA.'

  static flags = {
    occasion: Flags.string({description: 'casual, travel, business, wedding, etc.', default: 'casual'}),
    season: Flags.string({description: 'spring, summer, fall, or winter'}),
    region: Flags.string({description: 'Optional region to localize settings'}),
    n: Flags.integer({description: 'Number of looks', default: 5}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print full JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookSettings)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const settings = await client.mcpGet<Record<string, any>>('/lookbook/settings', {
      occasion: flags.occasion,
      season: flags.season,
      region: flags.region,
      n: flags.n,
    })

    if (flags.json) {
      this.log(printJson(settings))
      return
    }

    this.log(settings.disclosure)
    this.log(renderRecords(settings.looks || [], ['look', 'setting', 'composition', 'size', 'quality'], 'table'))
  }
}
