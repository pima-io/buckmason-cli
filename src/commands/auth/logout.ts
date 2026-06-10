import {Command, Flags} from '@oclif/core'
import {deleteToken, resolveCompanySlug, resolveHost} from '../../lib/config.js'

export default class AuthLogout extends Command {
  static description = 'Delete the stored Buck Mason customer-agent authorization.'

  static flags = {
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AuthLogout)
    const host = await resolveHost(flags.host)
    const company = await resolveCompanySlug(flags.company)
    const deleted = await deleteToken(host, company)
    this.log(deleted ? `Logged out of ${host} / ${company}.` : `No stored login for ${host} / ${company}.`)
  }
}
