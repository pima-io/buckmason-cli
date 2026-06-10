export interface OrderItemSummary {
  id: unknown
  product: unknown
  color: unknown
  size: unknown
  sku: unknown
  status: unknown
  shipment_status: unknown
  returnable: boolean
  return_blocker: string
}

export function summarizeOrderItems(order: Record<string, any>): OrderItemSummary[] {
  return (order.items || [])
    .filter((item: Record<string, any>) => item.shipment?.display_status !== 'canceled')
    .map((item: Record<string, any>) => ({
      id: item.id,
      product: item.product,
      color: item.color,
      size: item.size,
      sku: item.sku,
      status: item.rms_status || item.status,
      shipment_status: item.shipment?.display_status || '',
      returnable: isReturnable(item),
      return_blocker: returnBlocker(item),
    }))
}

export function isReturnable(item: Record<string, any>): boolean {
  return Boolean(item.rms_returnable) && inHand(item) && !item.final_sale && !hasAlterations(item)
}

function inHand(item: Record<string, any>): boolean {
  return item.shipment == null ||
    item.rms_status === 'completed' ||
    item.status === 'completed' ||
    ['delivered', 'picked_up'].includes(item.shipment?.display_status)
}

function returnBlocker(item: Record<string, any>): string {
  if (isReturnable(item)) return ''
  if (!inHand(item)) return statusLabel(item.shipment?.display_status) || 'Not yet delivered or picked up'
  if (item.final_sale) return 'Final sale'
  if (hasAlterations(item)) return 'Altered item'
  if (!item.rms_returnable) return 'Outside return policy'
  return 'Not returnable'
}

function hasAlterations(item: Record<string, any>): boolean {
  return Boolean(item.has_alterations || item.alterations)
}

function statusLabel(status?: string): string {
  return ({
    preparing: 'Preparing',
    in_transit: 'In transit',
    ready_for_pickup: 'Ready for pickup',
    delivered: 'Delivered',
    picked_up: 'Picked up',
    canceled: 'Canceled',
  } as Record<string, string>)[status || ''] || ''
}
