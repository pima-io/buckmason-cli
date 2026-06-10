export interface CalendarEvent {
  title?: string
  description?: string
  duration_days?: number
  is_travel?: boolean
  home_metro?: string
  event_location?: string
  customer_opt_in_for_this_event?: boolean
  customer_opt_out_for_this_class?: boolean
  customer_prior_positive?: boolean
}

export interface EventScore {
  score: number
  breakdown: {type: number; dress_code: number; duration: number; location: number; signal: number}
  action: 'skip' | 'soft' | 'editorial' | 'premium'
  reason: string
}

const VETO_PATTERNS = [
  /\b(dr\.?|doctor)\s+\w+/i, /physical/i, /appointment/i, /check[- ]?up/i,
  /dentist/i, /dental/i, /orthodontist/i, /therapy/i, /therapist/i,
  /counsel(?:or|ing)/i, /colonoscopy/i, /mammo/i, /obgyn/i, /primary care/i,
]

const TYPE_PATTERNS: Array<[RegExp, number, string]> = [
  [/\bwedding\b|engagement|black[- ]tie|gala|bar mitzvah|bat mitzvah|quinceañera/i, 4, 'formal-event'],
  [/\b(vacation|trip|travel)\b|\b(weekend|getaway)\b/i, 3, 'travel'],
  [/\b(concert|show|festival|theater|opera)\b|\bnightclub\b|speakeasy/i, 2, 'show'],
  [/\b(party|birthday|dinner|drinks|brunch|cocktails?)\b/i, 2, 'social'],
  [/\b(conference|sessions?|summit|keynote|panel|on[- ]stage|podcast|headshot)\b/i, 2, 'professional'],
  [/\b(school pickup|soccer practice|practice|carpool)\b/i, 0, 'family-logistics'],
  [/^\s*(block|focus|reminder|todo|task)\b/i, 0, 'block'],
  [/\b1[ \-:]on[ \-:]?1\b|\bone[ \-]on[ \-]one\b|\bcheck[- ]in\b|sync\b|coffee with\b|\bcatch up\b/i, 0, 'meeting'],
  [/\b(errand|costco|grocery|target run|dmv|cleaner|pharmacy)\b/i, 0, 'errand'],
]

const DRESS_CODE_EXPLICIT = /\b(black[- ]tie|white[- ]tie|smart[- ]casual|business casual|festive|cocktail|creative attire|formal attire)\b/i
const VENUE_HINTS = [
  /\bbestia\b/i, /\bn\/?naka\b/i, /\bcasa madera\b/i, /\brepublique\b/i,
  /\bspeakeasy\b/i, /\brooftop\b/i, /\bthe standard\b/i, /\bsohohouse\b/i,
  /\bchateau\b/i, /\bnomad\b/i, /\b1 hotel\b/i, /\bproper\b/i,
]

export function scoreEvent(event: CalendarEvent): EventScore {
  const title = (event.title || '').trim()
  const description = (event.description || '').trim()
  const type = classifyType(title, description)

  if (type.weight === -10) {
    return {
      score: -10,
      breakdown: {type: -10, dress_code: 0, duration: 0, location: 0, signal: 0},
      action: 'skip',
      reason: `hard-veto:${type.label}`,
    }
  }

  const dress = dressCodeWeight(title, description, type.label)
  const duration = event.duration_days && event.duration_days >= 2 ? 1 : 0
  const location = event.is_travel || (event.home_metro && event.event_location && !event.event_location.toLowerCase().includes(event.home_metro.toLowerCase())) ? 1 : 0
  const signal = event.customer_opt_out_for_this_class ? -2 : event.customer_opt_in_for_this_event ? 2 : event.customer_prior_positive ? 1 : 0
  const score = Math.max(0, type.weight + dress + duration + location + signal)

  return {
    score,
    breakdown: {type: type.weight, dress_code: dress, duration, location, signal},
    action: actionFor(score),
    reason: `${type.label}${dress > 0 ? '·dress_code' : ''}${duration ? '·multi-day' : ''}${location ? '·travel' : ''}`,
  }
}

function classifyType(title: string, description: string): {weight: number; label: string} {
  const text = `${title}\n${description}`
  if (VETO_PATTERNS.some((pattern) => pattern.test(text))) return {weight: -10, label: 'medical-or-therapy'}
  for (const [pattern, weight, label] of TYPE_PATTERNS) if (pattern.test(text)) return {weight, label}
  return {weight: 0, label: 'unclassified'}
}

function dressCodeWeight(title: string, description: string, typeLabel: string): number {
  const text = `${title}\n${description}`
  if (DRESS_CODE_EXPLICIT.test(text)) return 3
  if (VENUE_HINTS.some((pattern) => pattern.test(text))) return 2
  if (typeLabel === 'travel') return 2
  return 0
}

function actionFor(score: number): EventScore['action'] {
  if (score <= 5) return 'skip'
  if (score === 6) return 'soft'
  if (score <= 8) return 'editorial'
  return 'premium'
}
