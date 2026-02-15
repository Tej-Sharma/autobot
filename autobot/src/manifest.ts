import { ManifestMatch, RouteFlowConfig } from './types';

export const DEFAULT_ROUTES: RouteFlowConfig[] = [
  {
    key: 'home',
    path: '/',
    title: 'Home',
    ctaSelectors: [
      'a[href="/pricing"]',
      'a:has-text("Get started")',
      'a:has-text("Start")',
      'button:has-text("Get started")',
      'button:has-text("Start")',
    ],
    secondarySelectors: ['a[href*="/features"]', 'a[href="/trial"]'],
  },
  {
    key: 'pricing',
    path: '/pricing',
    title: 'Pricing',
    ctaSelectors: [
      'a[href*="trial"]',
      'button:has-text("Start")',
      'button:has-text("Get started")',
      '[role="button"]:has-text("Start")',
    ],
    secondarySelectors: ['a:has-text("Compare")', 'a[href*="/contact"]'],
  },
  {
    key: 'trial',
    path: '/trial',
    title: 'Trial',
    ctaSelectors: ['button:has-text("Sign")', 'button[type="submit"]', 'a[href="/auth"]'],
    secondarySelectors: ['a[href="/pricing"]'],
  },
  {
    key: 'features',
    path: '/features',
    title: 'Features',
    ctaSelectors: [
      'a[href*="/features"]',
      'a[href*="/pricing"]',
      'a:has-text("Get started")',
    ],
  },
  {
    key: 'downloads',
    path: '/downloads',
    title: 'Downloads',
    ctaSelectors: ['a[href*="/downloads"]', 'a[href*="apple"]', 'a[href*="google"]'],
    secondarySelectors: ['a:has-text("Get app")'],
  },
  {
    key: 'blog',
    path: '/blog',
    title: 'Blog',
    ctaSelectors: ['a[href*="/blog/"]', 'a:has-text("Read more")', 'a:has-text("Subscribe")'],
  },
  {
    key: 'guide',
    path: '/guide',
    title: 'Guide',
    ctaSelectors: ['a[href="/features"]', 'a:has-text("Get started")', 'a:has-text("Start")'],
  },
  {
    key: 'legal',
    path: '/legal/privacy-policy',
    title: 'Legal',
    ctaSelectors: ['a[href="/pricing"]', 'a:has-text("Get started")'],
  },
];

const byKey = new Map<string, RouteFlowConfig>(
  DEFAULT_ROUTES.map((route) => [route.key.toLowerCase(), route]),
);

const byPath = new Map<string, RouteFlowConfig>(
  DEFAULT_ROUTES.map((route) => [route.path.toLowerCase(), route]),
);

export const manifestDefaults = DEFAULT_ROUTES;

export function resolveRouteSpecs(tokens: string[]): ManifestMatch[] {
  const seen = new Set<string>();
  const out: ManifestMatch[] = [];

  for (const raw of tokens.length ? tokens : byKey.keys()) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;

    const key = token.startsWith('/') ? `path:${token}` : `key:${token}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (token.startsWith('/')) {
      const existing = byPath.get(token);
      if (existing) {
        out.push({ key: existing.key, spec: existing });
        continue;
      }
      out.push({
        key: `custom:${token}`,
        spec: {
          key: `custom-${token.replace(/[^a-z0-9]+/gi, '-')}`,
          path: token,
          title: token,
          ctaSelectors: ['a[href*="/pricing"]', 'button:has-text("Get started")', 'button'],
        },
      });
      continue;
    }

    const direct = byKey.get(token);
    if (direct) {
      out.push({ key: direct.key, spec: direct });
      continue;
    }

    out.push({
      key: `custom-${token}`,
      spec: {
        key: `custom-${token}`,
        path: `/${token}`,
        title: token,
        ctaSelectors: ['a[href*="/pricing"]', 'button:has-text("Get started")', 'button'],
      },
    });
  }

  return out;
}

export function toPathValue(value: string): string {
  if (value.startsWith('/')) return value;
  const found = byKey.get(value.toLowerCase());
  if (found) return found.path;
  return `/${value.replace(/^\/+/, '')}`;
}
