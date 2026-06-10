import {Command, Flags} from '@oclif/core'
import {buildHtmlLookbook} from '../../lookbook/build-html.js'

export default class LookbookBuild extends Command {
  static description = 'Build an HTML Buck Mason lookbook from config and picks JSON.'

  static flags = {
    config: Flags.string({required: true, description: 'Lookbook config JSON'}),
    picks: Flags.string({required: true, description: 'Picks JSON'}),
    out: Flags.string({required: true, description: 'Output directory'}),
    'look-images': Flags.string({description: 'Directory containing premium try-on images named look1.png, look2.png, ...'}),
    'no-tryon': Flags.boolean({description: 'Build editorial tier from product imagery instead of generated try-on images'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookBuild)
    const result = await buildHtmlLookbook({
      configPath: flags.config,
      picksPath: flags.picks,
      outDir: flags.out,
      lookImagesDir: flags['look-images'],
      noTryon: flags['no-tryon'],
    })
    this.log(`Wrote ${result.indexPath}`)
    this.log(`Wrote ${result.manifestPath}`)
  }
}
