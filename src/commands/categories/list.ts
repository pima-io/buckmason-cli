import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {printJson, renderRecords, type OutputFormat} from '../../lib/output.js'

export default class CategoriesList extends Command {
  static description = 'List Buck Mason category taxonomy from the public PIMA MCP API.'

  static flags = {
    gender: Flags.string({description: 'm, w, or u'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(CategoriesList)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const data = await client.mcpGet<Record<string, any>>('/categories', {gender: flags.gender})

    if (flags.output === 'json') {
      this.log(printJson(data))
      return
    }

    const rows = []
    for (const category of data.categories || []) {
      for (const style of category.styles || []) {
        rows.push({
          category: category.name,
          class: style.name,
          styles: (style.product_lines || []).map((line: any) => line.name).join(', '),
        })
      }
    }

    this.log(renderRecords(rows, ['category', 'class', 'styles'], flags.output as OutputFormat))
  }
}
