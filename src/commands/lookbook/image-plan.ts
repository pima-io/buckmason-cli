import {Command, Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import {parseProfile} from '../../lookbook/profile.js'
import {buildLookbookImagePlan, writeImagePlan} from '../../lookbook/image-generation.js'
import {printJson} from '../../lib/output.js'

export default class LookbookImagePlan extends Command {
  static description = 'Build deterministic gpt-image-2 prompts and input ordering for premium lookbook try-on images.'

  static flags = {
    config: Flags.string({required: true, description: 'Lookbook config JSON'}),
    picks: Flags.string({required: true, description: 'Picks JSON'}),
    profile: Flags.string({required: true, description: 'Customer profile.md with reference photos and build/face facts'}),
    out: Flags.string({description: 'Write image plan JSON to this path'}),
    quality: Flags.string({options: ['medium', 'high'], default: 'high', description: 'gpt-image-2 quality'}),
    size: Flags.string({default: '1024x1536', description: 'gpt-image-2 output size'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookImagePlan)
    const config = JSON.parse(await readFile(flags.config, 'utf8'))
    const picks = JSON.parse(await readFile(flags.picks, 'utf8'))
    const profile = parseProfile(await readFile(flags.profile, 'utf8'))
    const plan = buildLookbookImagePlan({
      config,
      picks,
      profile,
      quality: flags.quality as 'medium' | 'high',
      size: flags.size,
    })

    if (flags.out) {
      await writeImagePlan(plan, flags.out)
      this.log(`Wrote ${flags.out}`)
    } else {
      this.log(printJson(plan))
    }
  }
}
