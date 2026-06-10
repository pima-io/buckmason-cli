import {Command, Flags} from '@oclif/core'
import {Client} from '../lib/client.js'
import {printJson} from '../lib/output.js'

export default class Recommend extends Command {
  static description = 'Ask PIMA for a Buck Mason capsule recommendation.'

  static flags = {
    gender: Flags.string({required: true, description: 'm, w, or u'}),
    occasion: Flags.string({description: 'casual, business, travel, wedding, etc.'}),
    'dress-code': Flags.string({description: 'smart_casual, business_casual, cocktail, formal, etc.'}),
    season: Flags.string({description: 'spring, summer, fall, winter'}),
    'near-zip': Flags.string({description: 'ZIP for stock signal'}),
    budget: Flags.string({description: 'Total budget in dollars'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Recommend)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const data = await client.mcpGet('/recommend', {
      gender: flags.gender,
      occasion: flags.occasion,
      dress_code: flags['dress-code'],
      season: flags.season,
      near_zip: flags['near-zip'],
      budget: flags.budget,
    })
    this.log(printJson(data))
  }
}
