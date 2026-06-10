import {Command, Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import {scoreEvent} from '../../lookbook/score-event.js'
import {printJson} from '../../lib/output.js'

export default class LookbookScoreEvent extends Command {
  static description = 'Score a calendar event for lookbook suitability.'

  static flags = {
    file: Flags.string({description: 'JSON event file. Reads stdin when omitted.'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookScoreEvent)
    const raw = flags.file ? await readFile(flags.file, 'utf8') : await readStdin()
    const event = raw.trim() ? JSON.parse(raw) : {}
    this.log(printJson(scoreEvent(event)))
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}
