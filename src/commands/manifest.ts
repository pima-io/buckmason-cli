import {Command, Flags} from '@oclif/core'
import {Client} from '../lib/client.js'
import {printJson, renderRecords} from '../lib/output.js'

export default class Manifest extends Command {
  static description = 'Show the public PIMA MCP endpoint manifest for Buck Mason.'

  static flags = {
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print full manifest JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Manifest)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const manifest = await client.mcpGet<Record<string, any>>('/manifest')

    if (flags.json) {
      this.log(printJson(manifest))
      return
    }

    this.log(`${manifest.company} MCP ${manifest.version || ''}`.trim())
    this.log(renderRecords(manifest.endpoints || [], ['method', 'path', 'description'], 'table'))
  }
}
