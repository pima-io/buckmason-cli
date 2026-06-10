export interface ParsedProfile {
  [key: string]: unknown
  reference_photos?: string[]
  sizes?: Record<string, string>
  preferred_link_payment_methods?: Record<string, string>
}

export function parseProfile(text: string): ParsedProfile {
  const out: ParsedProfile = {}

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*-?\s*([a-z][a-z0-9_]*)\s*:\s*(.+?)\s*(?:#.*)?$/)
    if (!match) continue
    const key = match[1]
    const value = coerceProfileValue(stripQuotes(match[2].trim()))
    if (!(key in out)) out[key] = value
  }

  const photos = parseReferencePhotos(text)
  if (photos.length) out.reference_photos = photos

  const sizes = parseSizes(text)
  if (Object.keys(sizes).length) out.sizes = sizes

  const preferred = parsePreferredLinkPaymentMethods(text)
  if (Object.keys(preferred).length) out.preferred_link_payment_methods = preferred

  return out
}

function parseReferencePhotos(text: string): string[] {
  const photos: string[] = []
  for (const match of text.matchAll(/^\s*-\s*path:\s*(.+?)\s*(?:#.*)?$/gm)) {
    photos.push(stripQuotes(match[1].trim()))
  }

  if (!photos.length) {
    let inReferencePhotos = false
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*##\s*Reference\s+photos?\s*$/i.test(line)) {
        inReferencePhotos = true
        continue
      }

      if (inReferencePhotos && /^\s*##/.test(line)) break
      if (!inReferencePhotos) continue

      const match = line.match(/^\s*-\s*(\/.+?\.(?:jpe?g|png|heic|webp))(?:\s+[(#].*|\s*)$/i)
      if (match) photos.push(match[1])
    }
  }

  return [...new Set(photos.filter((photo) => photo.startsWith('/')))]
}

function parseSizes(text: string): Record<string, string> {
  const sizes: Record<string, string> = {}
  let inSizes = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*##\s*Sizes/i.test(line)) {
      inSizes = true
      continue
    }

    if (inSizes && /^\s*##/.test(line)) inSizes = false
    if (!inSizes) continue

    const match = line.match(/^\s*-?\s*(shirt|tee|pant|short|jacket|sport_coat|shoe|belt|jean)\s*:\s*([^\s#]+)/)
    if (match) sizes[match[1]] = match[2]
  }

  return sizes
}

function parsePreferredLinkPaymentMethods(text: string): Record<string, string> {
  const methods: Record<string, string> = {}
  let inPrefs = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*-?\s*preferred_link_payment_methods\s*:\s*(?:#.*)?$/.test(line)) {
      inPrefs = true
      continue
    }

    if (!inPrefs) continue
    if (!line.trim()) continue
    if (/^\S/.test(line)) break

    const match = line.match(/^\s+([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*(?:#.*)?$/)
    if (match) {
      const last4 = stripQuotes(match[2].trim())
      if (/^\d{4}$/.test(last4)) methods[match[1]] = last4
    }
  }

  return methods
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, '')
}

function coerceProfileValue(value: string): unknown {
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true'
  if (/^(null|none)?$/i.test(value)) return null
  return value
}
