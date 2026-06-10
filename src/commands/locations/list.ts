import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {renderRecords, type OutputFormat} from '../../lib/output.js'

export default class LocationsList extends Command {
  static description = 'List Buck Mason stores and warehouses exposed to the MCP catalog.'

  static flags = {
    'near-zip': Flags.string({description: 'ZIP for distance sorting'}),
    radius: Flags.integer({description: 'Radius in miles', default: 25}),
    pickup: Flags.boolean({description: 'Only pickup-enabled locations'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LocationsList)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const data = await client.mcpGet('/locations', {
      near_zip: flags['near-zip'],
      radius_mi: flags.radius,
      pickup_only: flags.pickup || undefined,
    })
    this.log(renderRecords((data as any).locations || [], ['id', 'name', 'distance_mi', 'pickup_enabled', 'address_city', 'address_state'], flags.output as OutputFormat))
  }
}
