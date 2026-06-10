import {Command, Flags} from '@oclif/core'
import {readFile, writeFile} from 'node:fs/promises'
import {handoff, rankVotes} from '../../lookbook/rank-votes.js'
import {printJson} from '../../lib/output.js'

export default class LookbookRankVotes extends Command {
  static description = 'Rank a voting-enabled lookbook and emit a checkout handoff.'

  static flags = {
    url: Flags.string({description: 'Lookbook URL. Reads /lookbook.json and /api/votes?public=1&fresh=1'}),
    manifest: Flags.string({description: 'Path or URL to lookbook.json'}),
    votes: Flags.string({description: 'Path or URL to votes JSON'}),
    format: Flags.string({options: ['text', 'json'], default: 'text'}),
    'max-items': Flags.integer({default: 8}),
    'min-item-votes': Flags.integer({default: 1}),
    'min-look-votes': Flags.integer({default: 1}),
    'no-look-backed': Flags.boolean({description: 'Only recommend items with positive item votes'}),
    'handoff-out': Flags.string({description: 'Write handoff text to this path'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookRankVotes)
    const manifestSource = flags.manifest || (flags.url ? joinUrl(flags.url, 'lookbook.json') : undefined)
    const votesSource = flags.votes || (flags.url ? joinUrl(flags.url, 'api/votes?public=1&fresh=1') : undefined)
    if (!manifestSource || !votesSource) throw new Error('Provide --url or both --manifest and --votes.')

    const manifest = await readJson(manifestSource)
    const votes = await readJson(votesSource)
    const tally = votes.tally || votes
    const ranked = rankVotes(manifest, tally, {
      maxItems: flags['max-items'],
      minItemVotes: flags['min-item-votes'],
      minLookVotes: flags['min-look-votes'],
      lookBacked: !flags['no-look-backed'],
    })
    const text = handoff(manifest, ranked.recommended, ranked.rankedLooks as any[], tally)
    if (flags['handoff-out']) await writeFile(flags['handoff-out'], text)
    this.log(flags.format === 'json' ? printJson({...ranked, handoff: text}) : text)
  }
}

async function readJson(source: string): Promise<any> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, {headers: {'User-Agent': 'buckmason-cli/0.1', Accept: 'application/json'}})
    if (!res.ok) throw new Error(`Failed to read ${source}: HTTP ${res.status}`)
    return res.json()
  }

  return JSON.parse(await readFile(source, 'utf8'))
}

function joinUrl(base: string, suffix: string): string {
  return new URL(suffix, base.endsWith('/') ? base : `${base}/`).toString()
}
