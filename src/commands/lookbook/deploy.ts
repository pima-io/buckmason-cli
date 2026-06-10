import {Command, Flags} from '@oclif/core'
import {deployWithWrangler, prepareCloudflarePagesDeploy} from '../../lookbook/deploy.js'

export default class LookbookDeploy extends Command {
  static description = 'Prepare and deploy a built lookbook to Cloudflare Pages via wrangler. Voting is on by default.'

  static flags = {
    dir: Flags.string({required: true, description: 'Built lookbook directory'}),
    project: Flags.string({required: true, description: 'Cloudflare Pages project name'}),
    'kv-id': Flags.string({description: 'Cloudflare KV namespace id for LOOKBOOK_VOTES'}),
    'lookbook-id': Flags.string({description: 'Override lookbook id for voting storage'}),
    'no-voting': Flags.boolean({description: 'Deploy read-only static lookbook without voting functions'}),
    'no-overwrite': Flags.boolean({description: 'Refuse to deploy if the Pages project already has deployments'}),
    'dry-run': Flags.boolean({description: 'Prepare files and validate, but do not deploy'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookDeploy)
    const kvId = flags['kv-id'] || process.env.LOOKBOOK_VOTES_KV_ID
    const prepared = await prepareCloudflarePagesDeploy({
      dir: flags.dir,
      project: flags.project,
      lookbookId: flags['lookbook-id'],
      kvId,
      withVoting: !flags['no-voting'],
    })
    this.log(`Prepared ${flags.dir} for Cloudflare Pages (${prepared.voting ? 'voting enabled' : 'read-only'}).`)
    const url = await deployWithWrangler({
      dir: flags.dir,
      project: flags.project,
      dryRun: flags['dry-run'],
      noOverwrite: flags['no-overwrite'],
    })
    this.log(flags['dry-run'] ? `Dry-run URL would be ${url}` : `Deployed: ${url}`)
  }
}
