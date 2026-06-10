import {Command, Flags} from '@oclif/core'
import {hostingOptions, hostingSafetyNotes, type HostingIntent} from '../../lookbook/hosting.js'
import {printJson, renderRecords} from '../../lib/output.js'

export default class LookbookHosting extends Command {
  static description = 'Show recommended ways to host a built HTML lookbook.'

  static flags = {
    intent: Flags.string({
      description: 'Hosting goal',
      options: ['quick', 'permanent', 'private', 'voting'],
    }),
    json: Flags.boolean({description: 'Print full JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookHosting)
    const options = hostingOptions(flags.intent as HostingIntent | undefined)
    const safety = hostingSafetyNotes()

    if (flags.json) {
      this.log(printJson({default: 'cloudflare-pages', intent: flags.intent || null, options, safety}))
      return
    }

    this.log('Default: Cloudflare Pages via wrangler.')
    this.log(renderRecords(options, ['rank', 'id', 'name', 'best_for', 'probe', 'deploy_hint', 'url_shape', 'persistence'], 'table'))
    this.log('\nSafety:')
    for (const note of safety) this.log(`- ${note}`)
  }
}
