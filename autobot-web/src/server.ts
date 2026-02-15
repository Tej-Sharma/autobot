import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

const app = express();
const webPublicPath = path.resolve(process.cwd(), 'public');

const PORT = Number(process.env.PORT || 4173);
const AUTOBOT_API_BASE_URL = process.env.AUTOBOT_API_BASE_URL?.replace(/\/$/, '') || '';

const toHeaderList = (headers: Headers) => Array.from(headers.entries());

const getSetCookies = (headers: Headers) => {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  return anyHeaders.getSetCookie?.() || [];
};

const parseProxyTarget = (pathname: string): string => {
  if (!AUTOBOT_API_BASE_URL) {
    throw new Error('AUTOBOT_API_BASE_URL is not configured');
  }
  const base = AUTOBOT_API_BASE_URL.endsWith('/') ? AUTOBOT_API_BASE_URL : `${AUTOBOT_API_BASE_URL}/`;
  return new URL(pathname, base).toString();
};

app.use(express.json());
app.use(express.static(webPublicPath));

app.use('/api', async (req, res) => {
  try {
    const targetUrl = parseProxyTarget(req.originalUrl);

    const headers = { ...req.headers } as Record<string, string | string[]>;
    delete headers.host;
    delete headers['content-length'];
    headers['x-forwarded-host'] = req.get('x-forwarded-host') || req.get('host') || '';
    headers['x-forwarded-proto'] = req.get('x-forwarded-proto') || req.protocol;
    const outgoing = req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body || {});

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: outgoing,
      redirect: 'manual',
    });

    for (const [key, value] of toHeaderList(response.headers)) {
      const lowered = key.toLowerCase();
      if (lowered === 'set-cookie' || lowered === 'transfer-encoding') {
        continue;
      }
      res.setHeader(key, value);
    }

    const setCookies = getSetCookies(response.headers);
    if (setCookies.length > 0) {
      res.setHeader('Set-Cookie', setCookies);
    }

    const payload = Buffer.from(await response.arrayBuffer());
    res.status(response.status).send(payload);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to proxy API request to autobot service',
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'autobot-web',
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(webPublicPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`autobot-web running at http://localhost:${PORT}`);
});
