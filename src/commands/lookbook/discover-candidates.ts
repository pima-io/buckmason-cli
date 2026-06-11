import {Command, Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {resolveCompanySlug, resolveHost} from '../../lib/config.js'
import {printJson} from '../../lib/output.js'
import {discoverWeeklyCandidates} from '../../lookbook/discover-candidates.js'

export default class LookbookDiscoverCandidates extends Command {
  static description = 'Discover weekly lookbook candidates from recent Buck Mason catalog items.'

  static flags = {
    gender: Flags.string({required: true, options: ['m', 'w', 'u'], description: 'Customer gender/category preference'}),
    sizes: Flags.string({required: true, description: 'JSON file or inline JSON, for example {"shirt":"L","pant":"31"}'}),
    wishlist: Flags.string({description: 'Wishlist JSONL path. Defaults to ~/.buckmason/wishlist.jsonl.', defaultHelp: '~/.buckmason/wishlist.jsonl'}),
    'since-days': Flags.integer({description: 'Recently-live window', default: 14}),
    max: Flags.integer({description: 'Maximum candidate count', default: 30}),
    'avoid-colors': Flags.string({description: 'Comma-separated color values to drop', default: 'vintage_product'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookDiscoverCandidates)
    const host = await resolveHost(flags.host)
    const company = await resolveCompanySlug(flags.company)
    const sizes = await parseJsonInput(flags.sizes)
    const data = await discoverWeeklyCandidates({
      host,
      company,
      gender: flags.gender as 'm' | 'w' | 'u',
      sinceDays: flags['since-days'],
      wishlistPath: flags.wishlist || defaultWishlistPath(),
      sizes,
      max: flags.max,
      avoidColors: flags['avoid-colors'].split(',').map((value) => value.trim()).filter(Boolean),
    })
    this.log(printJson(data))
  }
}

function defaultWishlistPath(): string {
  return path.join(os.homedir(), '.buckmason/wishlist.jsonl')
}

async function parseJsonInput(value: string): Promise<Record<string, string>> {
  if (value.trim().startsWith('{')) return JSON.parse(value)
  return JSON.parse(await readFile(value, 'utf8'))
}
