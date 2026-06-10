import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {renderRecords, type OutputFormat} from '../../lib/output.js'

export default class ReturnsLocations extends Command {
  static description = 'List stores eligible for in-store returns.'

  static flags = {
    'near-zip': Flags.string({description: 'ZIP for distance sorting'}),
    radius: Flags.integer({description: 'Radius in miles when --near-zip is used', default: 100}),
    key: Flags.string({description: 'PIMA public API key. Or set BUCKMASON_PIMA_KEY.'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ReturnsLocations)
    const client = await Client.create({host: flags.host, companySlug: flags.company, key: flags.key, token: null})
    const data = await client.apiGet<unknown>('/api/return_locations', {
      near_zip: flags['near-zip'],
      radius_mi: flags.radius,
    }, {
      authenticated: false,
    })

    const locations = Array.isArray(data) ? data : ((data as any)?.locations || [])
    this.log(renderRecords(locations, ['name', 'distance_mi', 'address_city', 'address_state', 'address_zip', 'phone'], flags.output as OutputFormat))
  }
}
