import {access, readFile} from 'node:fs/promises'
import path from 'node:path'

export interface ValidationResult {
  ok: boolean
  failures: string[]
  warnings: string[]
}

export async function validateLookbookDir(dir: string): Promise<ValidationResult> {
  const failures: string[] = []
  const warnings: string[] = []
  const indexPath = path.join(dir, 'index.html')
  const manifestPath = path.join(dir, 'lookbook.json')

  try {
    await access(indexPath)
  } catch {
    failures.push('index.html missing')
  }

  try {
    await access(manifestPath)
  } catch {
    failures.push('lookbook.json missing')
  }

  if (!failures.length) {
    const html = await readFile(indexPath, 'utf8')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (manifest.schema !== 'buck-mason-lookbook-manifest') failures.push('lookbook.json schema is not buck-mason-lookbook-manifest')
    if (!manifest.lookbook_id) failures.push('lookbook.json missing lookbook_id')
    if (!html.includes('AI-generated try-on previews') && !html.includes('Editorial tier')) {
      failures.push('lookbook disclosure missing')
    }
    if (!html.includes('buckmason.com/products/')) warnings.push('No buckmason.com product links found')
    if (!Array.isArray(manifest.looks) || !manifest.looks.length) failures.push('lookbook.json has no looks')
    if (!Array.isArray(manifest.items) || !manifest.items.length) failures.push('lookbook.json has no items')
    for (const item of manifest.items || []) {
      if (!item.sku || !item.name || !item.size || typeof item.price_cents !== 'number') {
        failures.push(`manifest item incomplete: ${item.name || item.sku || 'unknown'}`)
      }
    }
  }

  return {ok: failures.length === 0, failures, warnings}
}
