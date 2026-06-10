import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {renderRecords, type OutputFormat} from '../../lib/output.js'

export default class ProductsSearch extends Command {
  static description = 'Search Buck Mason products through the public PIMA MCP catalog.'

  static flags = {
    q: Flags.string({description: 'Search term'}),
    gender: Flags.string({description: 'm, w, or u'}),
    color: Flags.string({description: 'Exact color name'}),
    category: Flags.string({description: 'Category name or id'}),
    'near-zip': Flags.string({description: 'ZIP for nearby stock signal'}),
    'in-stock-only': Flags.boolean({description: 'Only include products with online stock signal'}),
    limit: Flags.integer({description: 'Results per page', default: 10}),
    page: Flags.integer({description: 'Page number', default: 1}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ProductsSearch)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const data = await client.mcpGet('/products', {
      q: flags.q,
      gender: flags.gender,
      color: flags.color,
      category: flags.category,
      near_zip: flags['near-zip'],
      in_stock_only: flags['in-stock-only'] || undefined,
      per_page: flags.limit,
      page: flags.page,
    })
    const products = (data as any).products || []
    this.log(renderRecords(products, ['id', 'name', 'color', 'price', 'online_in_stock', 'nearby_in_stock', 'url'], flags.output as OutputFormat))
  }
}
