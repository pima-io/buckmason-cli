export type HostingIntent = 'quick' | 'permanent' | 'private' | 'voting'

export interface HostingOption {
  id: string
  name: string
  rank: number
  best_for: string
  probe: string
  deploy_hint: string
  url_shape: string
  persistence: string
  cautions: string
}

const OPTIONS: HostingOption[] = [
  {
    id: 'cloudflare-pages',
    name: 'Cloudflare Pages via wrangler',
    rank: 1,
    best_for: 'Durable public-by-link lookbooks, default voting, Pages Functions, KV, and optional custom domains.',
    probe: 'command -v wrangler && wrangler whoami',
    deploy_hint: 'wrangler pages project create <project> --production-branch main; wrangler pages deploy <dir> --project-name <project> --branch main --commit-dirty=true',
    url_shape: 'https://<project>.pages.dev/',
    persistence: 'Permanent while the Pages project exists',
    cautions: 'Public-by-URL. Voting needs a LOOKBOOK_VOTES KV namespace id. Do not run wrangler login inside the lookbook flow.',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    rank: 2,
    best_for: 'Durable public static HTML when Vercel auth is already configured.',
    probe: 'command -v vercel && vercel whoami',
    deploy_hint: 'vercel deploy --yes --prod <dir>',
    url_shape: 'https://<deployment-or-project>.vercel.app/',
    persistence: 'Permanent while the Vercel project exists',
    cautions: 'First project link can be interactive. Treat unauthenticated Vercel as a soft-no and fall through.',
  },
  {
    id: 's3',
    name: 'AWS S3 static object',
    rank: 3,
    best_for: 'Customer-managed permanent hosting when a known public/static bucket is already configured.',
    probe: 'command -v aws && aws sts get-caller-identity',
    deploy_hint: 'aws s3 cp <dir>/index.html s3://<bucket>/<key>/index.html --content-type text/html',
    url_shape: 'https://<bucket>.s3.amazonaws.com/<key>/index.html',
    persistence: 'Permanent until the object is deleted',
    cautions: 'Use only with an explicit bucket from the customer/profile. Do not create buckets or public policies from the agent flow.',
  },
  {
    id: 'local-tailscale',
    name: 'Local server over Tailscale',
    rank: 4,
    best_for: 'Private review across the customer’s own devices or trusted tailnet, without publishing to the public web.',
    probe: 'command -v tailscale && tailscale status',
    deploy_hint: 'python3 -m http.server 8787 --directory <dir> --bind 0.0.0.0; share http://<tailscale-host-or-ip>:8787/',
    url_shape: 'http://<tailscale-host-or-ip>:8787/',
    persistence: 'Only while the local server is running',
    cautions: 'Not public internet hosting. Good for private review; bad for partner sharing outside the tailnet.',
  },
  {
    id: 'local-file',
    name: 'Local HTML file',
    rank: 5,
    best_for: 'No publish, no cloud, quickest local handoff on the same machine.',
    probe: 'test -f <dir>/index.html',
    deploy_hint: 'open <dir>/index.html',
    url_shape: 'file://<dir>/index.html',
    persistence: 'As long as the local files remain',
    cautions: 'No shareable web URL and no social unfurl. Best when the customer explicitly wants local-only.',
  },
  {
    id: '0x0',
    name: '0x0.st anonymous upload',
    rank: 6,
    best_for: 'Fast throwaway public link when no authenticated host is available.',
    probe: 'command -v curl',
    deploy_hint: 'curl -sS -F "file=@<dir>/index.html;type=text/html" https://0x0.st',
    url_shape: 'https://0x0.st/<id>.html',
    persistence: 'Ephemeral; usually at least 30 days',
    cautions: 'Anonymous and public. Tell the customer it is temporary before using it.',
  },
]

const INTENT_ORDER: Record<HostingIntent, string[]> = {
  quick: ['cloudflare-pages', 'vercel', '0x0', 'local-file'],
  permanent: ['cloudflare-pages', 'vercel', 's3'],
  private: ['local-tailscale', 'local-file', 's3'],
  voting: ['cloudflare-pages', 'vercel'],
}

export function hostingOptions(intent?: HostingIntent): HostingOption[] {
  if (!intent) return OPTIONS

  const ids = INTENT_ORDER[intent]
  return ids.map((id, index) => {
    const option = OPTIONS.find((candidate) => candidate.id === id)
    if (!option) throw new Error(`Unknown hosting option ${id}.`)
    return {...option, rank: index + 1}
  })
}

export function hostingSafetyNotes(): string[] {
  return [
    'Confirm before publishing. Hosted lookbooks are public-by-URL unless the customer chose local/Tailscale.',
    'If a CLI is installed but unauthenticated, treat that host as unavailable and fall through.',
    'For AI try-on lookbooks, say that anyone with the link can view the generated try-on images.',
    'Use Cloudflare Pages when default voting is required; other hosts need custom backend work for votes.',
  ]
}
