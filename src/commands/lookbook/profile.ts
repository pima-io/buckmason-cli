import {Command, Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import {parseProfile} from '../../lookbook/profile.js'
import {printJson} from '../../lib/output.js'

export default class LookbookProfile extends Command {
  static description = 'Parse a Buck Mason stylist profile.md into structured JSON.'

  static flags = {
    file: Flags.string({required: true, description: 'Profile markdown file'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookProfile)
    this.log(printJson(parseProfile(await readFile(flags.file, 'utf8'))))
  }
}
