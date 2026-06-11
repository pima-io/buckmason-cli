import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {renderRecords, type OutputFormat} from '../../lib/output.js'
import {productSearchParams, type ProductSort} from '../../lib/products.js'

export default class ProductsSearch extends Command {
  static description = 'Search Buck Mason products through the public PIMA MCP catalog.'

  static flags = {
    q: Flags.string({description: 'Search term'}),
    gender: Flags.string({description: 'm, w, or u'}),
    color: Flags.string({description: 'Exact color name'}),
    category: Flags.string({description: 'Category name or id'}),
    'near-zip': Flags.string({description: 'ZIP for nearby stock signal'}),
    'in-stock-only': Flags.boolean({description: 'Only include products with online stock signal'}),
    sort: Flags.string({options: ['name', 'newest'], default: 'name', description: 'Sort products by name or newest live signal'}),
    days: Flags.integer({description: 'Recently-live window in days when --sort newest is used', default: 90}),
    limit: Flags.integer({description: 'Results per page', default: 10}),
    page: Flags.integer({description: 'Page number', default: 1}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ProductsSearch)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const data = await client.mcpGet('/products', productSearchParams({
      q: flags.q,
      gender: flags.gender,
      color: flags.color,
      category: flags.category,
      nearZip: flags['near-zip'],
      inStockOnly: flags['in-stock-only'],
      limit: flags.limit,
      page: flags.page,
      sort: flags.sort as ProductSort,
      days: flags.days,
    }))
    const products = (data as any).products || []
    this.log(renderRecords(products, ['id', 'name', 'color', 'price', 'online_in_stock', 'nearby_in_stock', 'url'], flags.output as OutputFormat))
  }
}
