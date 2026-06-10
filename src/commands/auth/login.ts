import {Command, Flags} from '@oclif/core'
import {customerLogin, DEFAULT_SCOPES} from '../../lib/auth.js'

export default class AuthLogin extends Command {
  static description = 'Authorize this agent with a Buck Mason customer account via PIMA email magic link.'

  static examples = [
    '<%= config.bin %> auth login --email customer@example.com',
    '<%= config.bin %> auth login --email customer@example.com --scopes customer.orders.read,customer.returns.read,customer.returns.create,customer.address.read',
  ]

  static flags = {
    email: Flags.string({required: true, description: 'Customer email address'}),
    host: Flags.string({description: 'PIMA host', default: 'https://pima.io'}),
    company: Flags.string({description: 'PIMA company slug', default: 'buckmason'}),
    'agent-name': Flags.string({description: 'Name shown to the customer on the authorization screen'}),
    scopes: Flags.string({description: 'Comma-separated customer scopes'}),
    'no-open': Flags.boolean({description: 'Do not try to open any browser URL'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AuthLogin)
    const scopes = flags.scopes ? flags.scopes.split(',').map((scope) => scope.trim()).filter(Boolean) : DEFAULT_SCOPES
    const token = await customerLogin({
      email: flags.email,
      host: flags.host,
      companySlug: flags.company,
      agentName: flags['agent-name'],
      scopes,
      openBrowser: !flags['no-open'],
    })

    this.log('\nLogged in.')
    this.log(`Scopes: ${token.scopes.join(', ') || '(none)'}`)
  }
}
