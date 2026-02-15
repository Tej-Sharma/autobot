import crypto from 'node:crypto';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const normalizeBaseUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/$/, '');
};

export const buildAbsoluteUrl = (baseUrl: string, routePath: string): string => {
  const base = normalizeBaseUrl(baseUrl);
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${base}${normalizedPath === '/' ? '' : normalizedPath}`;
};

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .replace(/-+/g, '-');

export const stableId = (): string =>
  crypto.createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 24);

export const uniqueList = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

export const parseCommaSeparated = (value: string | undefined): string[] => {
  if (!value) return [];
  return uniqueList(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
};

export const isHttpError = (value: unknown): value is Error => {
  return !!value && value instanceof Error;
};
