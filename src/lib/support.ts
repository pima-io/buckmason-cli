export interface SupportContact {
  email: string
  phone: string
  liveChat: string
  faq: string
  pressEmail: string
}

export interface SupportLink {
  label: string
  url: string
}

export interface SupportInfo {
  source: string
  contact: SupportContact
  selfService: SupportLink[]
  notes: string[]
}

export const BUCK_MASON_SUPPORT_INFO: SupportInfo = {
  source: 'https://www.buckmason.com/pages/faq',
  contact: {
    email: 'help@buckmason.com',
    phone: '888-988-5560',
    liveChat: 'Open the FAQ page and use the live chat widget.',
    faq: 'https://www.buckmason.com/pages/faq',
    pressEmail: 'media@buckmason.com',
  },
  selfService: [
    {label: 'Track package', url: 'https://orders.buckmason.com/'},
    {label: 'Returns + exchanges', url: 'https://orders.buckmason.com/returns'},
    {label: 'Log in', url: 'https://orders.buckmason.com/auth'},
    {label: 'Find a store', url: 'https://www.buckmason.com/pages/our-stores'},
    {label: 'Gift card balance', url: 'https://www.buckmason.com/pages/gift-card-balance'},
  ],
  notes: [
    'Returns are accepted for a full refund within 365 days of purchase when items are unworn, unwashed, undamaged, and have intact original tags.',
    'Returns to any Buck Mason store location are free. Mail returns have an $8 flat-rate fee deducted from the refund; exchanges do not have a return fee.',
    'For damaged or incorrect items, address changes, order modifications, cancellations, lost packages, or international returns, contact support by text/phone or email.',
    'Outlet purchases, altered items, and vintage items are final sale. Bloomingdale\'s purchases must be returned or exchanged through Bloomingdale\'s stores.',
  ],
}

export function renderSupportInfo(info: SupportInfo = BUCK_MASON_SUPPORT_INFO): string {
  const lines = [
    'Buck Mason support',
    `Source: ${info.source}`,
    '',
    'Contact',
    `- Email: ${info.contact.email}`,
    `- Text or phone: ${info.contact.phone}`,
    `- Live chat: ${info.contact.liveChat}`,
    `- FAQ: ${info.contact.faq}`,
    `- Press inquiries: ${info.contact.pressEmail}`,
    '',
    'Self-service',
    ...info.selfService.map((link) => `- ${link.label}: ${link.url}`),
    '',
    'Notes',
    ...info.notes.map((note) => `- ${note}`),
  ]

  return lines.join('\n')
}
