import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {printJson, renderRecords, type OutputFormat} from '../../lib/output.js'

export default class ProductsSeasonal extends Command {
  static description = 'List recently-live products as the current season signal.'

  static flags = {
    gender: Flags.string({description: 'm, w, or u'}),
    category: Flags.string({description: 'Category name or id'}),
    days: Flags.integer({description: 'Recently-live window in days', default: 30}),
    limit: Flags.integer({description: 'Maximum products', default: 24}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ProductsSeasonal)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const data = await client.mcpGet<Record<string, any>>('/seasonal', {
      gender: flags.gender,
      category: flags.category,
      days: flags.days,
      limit: flags.limit,
    })

    if (flags.output === 'json') {
      this.log(printJson(data))
      return
    }

    const rows = []
    for (const group of data.categories || []) {
      for (const product of group.products || []) rows.push({...product, category: group.category})
    }

    this.log(renderRecords(rows, ['category', 'id', 'name', 'color', 'price', 'url'], flags.output as OutputFormat))
  }
}
