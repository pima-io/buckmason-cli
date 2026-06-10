import {Command, Flags} from '@oclif/core'
import {readToken, resolveCompanySlug, resolveHost} from '../../lib/config.js'
import {printJson} from '../../lib/output.js'

export default class AuthStatus extends Command {
  static description = 'Show the stored Buck Mason customer-agent authorization.'

  static flags = {
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AuthStatus)
    const host = await resolveHost(flags.host)
    const company = await resolveCompanySlug(flags.company)
    const token = await readToken(host, company)
    if (!token) {
      this.log(`Not logged in to ${host} / ${company}.`)
      return
    }

    if (flags.json) {
      this.log(printJson({...token, access_token: token.access_token ? '[redacted]' : undefined}))
      return
    }

    this.log(`Logged in to ${host} / ${company}`)
    this.log(`Customer: ${token.customer?.name || token.customer?.email || '(unknown)'}`)
    this.log(`Scopes: ${token.scopes.join(', ') || '(none)'}`)
    if (token.expires_at) this.log(`Expires: ${new Date(token.expires_at * 1000).toISOString()}`)
  }
}
