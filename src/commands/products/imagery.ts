import {Command, Flags, Args} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {printJson, renderRecords} from '../../lib/output.js'

export default class ProductsImagery extends Command {
  static description = 'Show product imagery roles for lookbook and try-on pipelines.'

  static args = {
    id: Args.string({required: true, description: 'Numeric product id, slug, or product code'}),
  }

  static flags = {
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print full JSON'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ProductsImagery)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const imagery = await client.mcpGet<Record<string, any>>(`/products/${encodeURIComponent(args.id)}/imagery`)

    if (flags.json) {
      this.log(printJson(imagery))
      return
    }

    const rows = [
      {role: 'try_on', url: imagery.try_on?.url, type: imagery.try_on?.type, note: imagery.try_on_warning || ''},
      {role: 'hero', url: imagery.hero?.url, type: imagery.hero?.type, note: ''},
      ...(imagery.detail || []).map((image: any, index: number) => ({
        role: `detail_${index + 1}`,
        url: image.url,
        type: image.type,
        note: image.alt || '',
      })),
    ]

    this.log(`${imagery.product_name}\n${imagery.product_url}`)
    this.log(renderRecords(rows, ['role', 'type', 'url', 'note'], 'table'))
  }
}
