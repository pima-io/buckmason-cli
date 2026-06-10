export interface VoteBucket {
  up: number
  down: number
  total: number
  net: number
  like_rate: number | null
}

export interface RankOptions {
  minItemVotes?: number
  minLookVotes?: number
  maxItems?: number
  lookBacked?: boolean
}

export function money(cents: number): string {
  return cents % 100 === 0 ? `$${Math.round(cents / 100)}` : `$${(cents / 100).toFixed(2)}`
}

export function voteBucket(raw: any): VoteBucket {
  const up = Number(raw?.up || 0)
  const down = Number(raw?.down || 0)
  const total = up + down
  return {up, down, total, net: up - down, like_rate: total ? up / total : null}
}

export function rankVotes(manifest: any, tally: any, options: RankOptions = {}) {
  const minItemVotes = options.minItemVotes ?? 1
  const minLookVotes = options.minLookVotes ?? 1
  const maxItems = options.maxItems ?? 8
  const lookBacked = options.lookBacked ?? true
  const lookOrder = new Map((manifest.looks || []).map((look: any, index: number) => [look.id, index]))
  const itemOrder = new Map((manifest.items || []).map((item: any, index: number) => [item.sku || `item-${index}`, index]))

  const looks = Object.fromEntries((manifest.looks || []).map((look: any) => [
    look.id,
    {...look, votes: voteBucket(tally?.looks?.[look.id])},
  ]))

  const rankedLooks = Object.values(looks).sort((a: any, b: any) =>
    b.votes.net - a.votes.net ||
    b.votes.up - a.votes.up ||
    (b.votes.like_rate || 0) - (a.votes.like_rate || 0) ||
    Number(lookOrder.get(a.id) || 9999) - Number(lookOrder.get(b.id) || 9999),
  )

  const rankedItems = (manifest.items || []).map((item: any, index: number) => {
    const sku = item.sku || ''
    const look = looks[item.look_id] || {}
    const itemVotes = voteBucket(tally?.items?.[sku])
    const lookVotes = (look as any).votes || voteBucket({})
    const itemSignal = itemVotes.total >= minItemVotes && itemVotes.net > 0
    const lookSignal = lookBacked && itemVotes.total === 0 && lookVotes.total >= minLookVotes && lookVotes.net > 0
    const blockedByItemPass = itemVotes.total > 0 && itemVotes.net <= 0
    const recommended = (itemSignal || lookSignal) && !blockedByItemPass
    const score =
      itemVotes.net * 100 +
      itemVotes.up * 8 -
      itemVotes.down * 12 +
      (itemVotes.like_rate || 0) * 20 +
      lookVotes.net * 12 +
      lookVotes.up * 2 +
      (lookVotes.like_rate || 0) * 6 -
      (lookSignal && !itemSignal ? 6 : 0)

    return {
      ...item,
      votes: itemVotes,
      look_votes: lookVotes,
      recommended,
      basis: itemVotes.total ? 'item votes' : 'look votes',
      reason: itemVotes.total
        ? `${bucketLabel(itemVotes)} on item; ${bucketLabel(lookVotes)} on ${(look as any).eyebrow || item.look_id}`
        : `no item votes; ${bucketLabel(lookVotes)} on ${(look as any).eyebrow || item.look_id}`,
      score,
      _order: itemOrder.get(sku) ?? index,
      _look_order: lookOrder.get(item.look_id) ?? 9999,
    }
  }).sort((a: any, b: any) =>
    Number(b.recommended) - Number(a.recommended) ||
    b.score - a.score ||
    b.votes.up - a.votes.up ||
    b.look_votes.up - a.look_votes.up ||
    a._look_order - b._look_order ||
    a._order - b._order,
  )

  const recommended = rankedItems.filter((item: any) => item.recommended).slice(0, maxItems)
  return {rankedLooks, rankedItems, recommended}
}

export function handoff(manifest: any, recommended: any[], rankedLooks: any[], tally: any): string {
  const title = manifest.title || manifest.lookbook_id || 'Lookbook'
  const date = manifest.date || ''
  const voteCount = Number(tally?.count || 0)
  if (!recommended.length) {
    return [
      `Buck Mason - ${title}${date ? ` (${date})` : ''}`,
      '',
      'No positive voted cart recommendation yet.',
      `Votes counted: ${voteCount}`,
      'Ask for more votes, lower the minimum vote threshold, or choose items manually from the lookbook.',
    ].join('\n')
  }

  const subtotal = recommended.reduce((sum, item) => sum + Number(item.price_cents || 0) * Number(item.quantity || 1), 0)
  return [
    `Buck Mason - ${title}${date ? ` (${date})` : ''}`,
    '',
    "I'd like to order the top-voted picks:",
    ...recommended.map((item) => `- ${item.name} - size ${item.size} - ${money(Number(item.price_cents || 0))}${Number(item.quantity || 1) > 1 ? ` (x${item.quantity})` : ''}`),
    '',
    `Subtotal at vote pick: ${money(subtotal)}`,
    `Votes counted: ${voteCount}`,
    rankedLooks[0]?.votes?.total ? `Top look: ${rankedLooks[0].eyebrow || rankedLooks[0].id} (${bucketLabel(rankedLooks[0].votes)}).` : '',
    '',
    'Vote basis:',
    ...recommended.map((item) => `- ${item.name}: ${item.reason}`),
    '',
    'Please re-check live stock and price, confirm shipping or pickup, any coupon or credit, and run checkout.',
  ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n')
}

function bucketLabel(bucket: VoteBucket): string {
  return `${bucket.up} like / ${bucket.down} pass`
}
