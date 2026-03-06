export async function crawlHomepageLinks(
  baseUrl: string,
  maxLinks: number,
): Promise<string[]> {
  const paths = new Set<string>(["/"]);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(baseUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AutobotCrawler/1.0' },
    });
    clearTimeout(timeout);

    if (!res.ok) return ["/"];

    const html = await res.text();
    const origin = new URL(baseUrl).origin;
    const hrefRegex = /href=["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;

    while ((match = hrefRegex.exec(html)) !== null) {
      if (paths.size > maxLinks) break;

      const href = match[1];
      try {
        const resolved = new URL(href, baseUrl);
        if (resolved.origin !== origin) continue;
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;

        const pathname = resolved.pathname.replace(/\/+$/, '') || '/';
        if (pathname === '/') continue;
        if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|xml|txt|pdf)$/i.test(pathname)) continue;
        if (pathname.startsWith('/api/')) continue;
        if (pathname.includes('#') || pathname.startsWith('mailto:') || pathname.startsWith('tel:')) continue;

        paths.add(pathname);
      } catch {
        // invalid URL, skip
      }
    }
  } catch {
    // fetch failed, return just root
  }

  return Array.from(paths).slice(0, maxLinks + 1);
}
