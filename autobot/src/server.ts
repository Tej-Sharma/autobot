import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config';
import { RunRequest } from './types';
import { qaQueue } from './queue';
import { parseRunPayload, normalizeRequestForExecution } from './runnerConfig';
import { enqueueRun } from './queue';
import { getJobStatus, getJobReport } from './state';
import { checkRateLimit } from './rateLimit';
import { crawlHomepageLinks } from './crawl';
import { isRepoAllowed, parseWebhookRun } from './github';
import { upsertRepoTokenMappings } from './repoTokens';
import { getRepoConfig } from './repoConfig';
import { registerConsoleRoutes } from './consoleApi';
import { saveLead, getLead, addLeadRun, getLeadRunHistory } from './leads';
import { sendReportEmail } from './email';
import { createCheckoutSession, handleStripeWebhook, getSubscriptionStatus } from './billing';
import { getMonitors, addMonitor, removeMonitor, toggleMonitor } from './monitors';
import { RunReport } from './types';

const app = express();
const rawGithub = express.raw({ type: 'application/json', limit: '4mb' });
const jsonBody = express.json({ limit: '2mb' });

app.use('/artifacts', express.static(path.resolve(CONFIG.artifactRoot)));

const verifyApiToken = (req: express.Request): boolean => {
  if (!CONFIG.autobotApiToken) return true;
  const header = req.headers['x-api-key'];
  if (typeof header !== 'string') return false;
  const expected = Buffer.from(CONFIG.autobotApiToken);
  const received = Buffer.from(header);
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
};

const verifyWebhookSignature = (signature: string | undefined, body: Buffer): boolean => {
  if (!CONFIG.githubWebhookSecret) return true;
  if (!signature) return false;
  const digest = `sha256=${crypto.createHmac('sha256', CONFIG.githubWebhookSecret).update(body).digest('hex')}`;
  const expected = Buffer.from(digest);
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
};

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'autobot',
    queue: qaQueue.name,
  });
});

app.post('/api/qa/run', jsonBody, async (req, res) => {
  if (!verifyApiToken(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const parsed = parseRunPayload(req.body as Record<string, unknown>);
  if (parsed.validationErrors.length > 0) {
    res.status(400).json({ error: parsed.validationErrors });
    return;
  }

  const request: RunRequest = {
    ...normalizeRequestForExecution(parsed.request),
    source: 'api',
    sourceMetadata: {
      ...(parsed.request.sourceMetadata || {}),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    },
  };

  const jobId = await enqueueRun(request);
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    ok: true,
    jobId,
    statusUrl: `${base}/api/qa/jobs/${jobId}`,
    artifactsUrl: `${base}/artifacts/${jobId}`,
    job: `/api/qa/jobs/${jobId}`,
  });
});

app.post('/api/qa/try', jsonBody, async (req, res) => {
  const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ error: 'URL must use http or https' });
      return;
    }
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.local') || /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(hostname)) {
      res.status(400).json({ error: 'Private/local URLs are not allowed' });
      return;
    }
  } catch {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const rateCheck = await checkRateLimit(ip, CONFIG.freeTrialMaxPerDay, 86400);
  if (!rateCheck.allowed) {
    res.status(429).json({ error: 'rate_limit', retryAfterSec: rateCheck.retryAfterSec, remaining: 0 });
    return;
  }

  const request: RunRequest = {
    environment: 'custom',
    baseUrl: rawUrl,
    routes: ['/'],
    mode: 'smoke',
    viewports: [{ name: 'desktop', width: 1280, height: 720 }],
    includeJudge: true,
    testMode: 'screenshots-only',
    source: 'web-trial',
    sourceMetadata: { ip, userAgent: req.headers['user-agent'] },
  };

  const jobId = await enqueueRun(request);
  res.json({ ok: true, jobId, remaining: rateCheck.remaining });
});

app.get('/api/qa/jobs/:jobId', async (req, res) => {
  const jobId = req.params.jobId;
  const status = await getJobStatus(jobId);
  if (!status) {
    res.status(404).json({ error: 'job not found' });
    return;
  }

  // Prevent browser from caching polling responses (avoids stale 304s)
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');

  const base = `${req.protocol}://${req.get('host')}`;

  // Try reading report from Redis first (works across separate server/worker services),
  // then fall back to disk (same-machine worker)
  let report: unknown = null;
  try {
    report = await getJobReport(jobId);
  } catch (err) {
    console.error(`[api] failed to read report from Redis for ${jobId}:`, err);
  }
  if (!report && status.reportPath && fs.existsSync(status.reportPath)) {
    try {
      report = JSON.parse(fs.readFileSync(status.reportPath, 'utf8'));
    } catch { /* ignore */ }
  }

  res.json({
    ...status,
    ...(report ? { report } : {}),
    reportUrl: `${base}/artifacts/${jobId}/qa-report.json`,
    reportMarkdownUrl: `${base}/artifacts/${jobId}/qa-report.md`,
  });
});

app.post('/api/integrations/repo-tokens', jsonBody, async (req, res) => {
  if (!verifyApiToken(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const rawRepos: unknown[] = Array.isArray(req.body?.repos) ? (req.body.repos as unknown[]) : [];
  const repos = rawRepos
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.includes('/'));

  const actor = typeof req.body?.actor === 'string' ? req.body.actor.trim() : '';
  const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';

  if (!actor || !accessToken || repos.length === 0) {
    res.status(400).json({ error: 'actor, accessToken, and repos[] are required' });
    return;
  }

  try {
    const result = await upsertRepoTokenMappings(repos, actor, accessToken);
    res.json({
      ok: result.failed.length === 0,
      updated: result.updated,
      failed: result.failed,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'token registration failed' });
  }
});

app.post('/api/github/webhook', rawGithub, async (req, res) => {
  const body = req.body;
  if (!Buffer.isBuffer(body)) {
    res.status(400).json({ error: 'invalid webhook body encoding' });
    return;
  }

  const signature = req.get('x-hub-signature-256') ?? undefined;

  if (!verifyWebhookSignature(signature, body)) {
    res.status(403).json({ error: 'invalid signature' });
    return;
  }

  try {
    const payload = JSON.parse(body.toString('utf8')) as any;
    const eventType = (req.get('x-github-event') || '').toLowerCase();

    if (eventType === 'issue_comment') {
      if (payload.action !== 'created') {
        res.json({ ok: true, ignored: true, reason: 'not a created comment' });
        return;
      }

      const requestFromCommand = await parseWebhookRun(payload);
      if (!requestFromCommand) {
        res.json({ ok: true, ignored: true, reason: 'no qa run command or repo not allowed' });
        return;
      }

      const request: RunRequest = {
        ...requestFromCommand,
        source: 'github',
        sourceMetadata: {
          ...(requestFromCommand.sourceMetadata || {}),
          issueCommentId: payload.comment?.id,
          actor: payload.sender?.login,
          repository: payload.repository?.full_name,
          event: eventType,
          action: payload.action,
        },
      };

      const jobId = await enqueueRun(request);
      res.json({ ok: true, jobId, source: 'issue_comment' });
      return;
    }

    if (eventType === 'pull_request') {
      const action = payload.action;
      const owner = payload.repository?.owner?.login;
      const repo = payload.repository?.name;
      if (!owner || !repo || !isRepoAllowed(owner, repo) || (action !== 'opened' && action !== 'synchronize')) {
        res.json({ ok: true, ignored: true, reason: 'no pull_request trigger for this event' });
        return;
      }

      const shouldAutoRun =
        (action === 'opened' && CONFIG.autoRunOnPrOpen) || (action === 'synchronize' && CONFIG.autoRunOnPrSync);
      if (!shouldAutoRun) {
        res.json({ ok: true, ignored: true, reason: 'auto-run disabled in config' });
        return;
      }

      // Load per-repo config for test mode
      const repoFullName = `${owner}/${repo}`;
      const repoConfig = await getRepoConfig(repoFullName);
      const testMode = repoConfig?.testMode ?? 'screenshots-only';

      // Use 'managed' environment for AI test modes (agentic/scriptgen)
      // which provisions a Fly machine. Screenshots-only uses 'preview' (existing behavior).
      const environment = testMode !== 'screenshots-only' ? 'managed' : 'preview';

      const request: RunRequest = {
        environment,
        routes: CONFIG.defaultRoutes,
        mode: CONFIG.defaultMode,
        viewports: CONFIG.defaultViewports,
        includeJudge: CONFIG.defaultJudge,
        source: 'github',
        sourceMetadata: {
          source: 'github',
          event: eventType,
          action,
          pullRequestId: payload.number,
        },
        repo: { owner, name: repo },
        prNumber: payload.number,
        sha: payload.pull_request?.head?.sha,
        branch: payload.pull_request?.head?.ref,
        actor: payload.sender?.login,
        testMode,
      };

      const jobId = await enqueueRun(request);
      res.json({ ok: true, auto: true, jobId, source: 'pull_request' });
      return;
    }

    res.json({ ok: true, ignored: true, reason: `unsupported event ${eventType}` });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'invalid payload' });
  }
});

// --- Sprint 2: Lead capture + email report ---

app.post('/api/leads/capture', jsonBody, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId.trim() : '';
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Valid email is required' });
    return;
  }
  if (!jobId) {
    res.status(400).json({ error: 'jobId is required' });
    return;
  }

  await saveLead({ email, jobId, url, createdAt: new Date().toISOString() });
  await addLeadRun(email, jobId);

  // Try to send email report if job has a report (Redis first, then disk)
  let emailSent = false;
  let reportForEmail: RunReport | null = null;
  try {
    const redisReport = await getJobReport(jobId);
    if (redisReport) reportForEmail = redisReport as RunReport;
  } catch { /* ignore */ }
  if (!reportForEmail) {
    const status = await getJobStatus(jobId);
    if (status?.reportPath && fs.existsSync(status.reportPath)) {
      try {
        reportForEmail = JSON.parse(fs.readFileSync(status.reportPath, 'utf8')) as RunReport;
      } catch { /* ignore */ }
    }
  }
  if (reportForEmail) {
    try {
      const result = await sendReportEmail(email, jobId, reportForEmail);
      emailSent = result.ok;
    } catch {
      // email sending is best-effort
    }
  }

  res.json({ ok: true, emailSent });
});

app.get('/api/leads/me', async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  if (!email) {
    res.status(400).json({ error: 'email query param required' });
    return;
  }

  const lead = await getLead(email);
  if (!lead) {
    res.status(404).json({ error: 'lead not found' });
    return;
  }

  const runs = await getLeadRunHistory(email);
  const subscription = await getSubscriptionStatus(email);

  res.json({ ...lead, runs, subscription });
});

// --- Sprint 3: Stripe billing ---

app.post('/api/billing/checkout', jsonBody, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email) {
    res.status(400).json({ error: 'email is required' });
    return;
  }

  try {
    const base = CONFIG.appPublicUrl || `${req.protocol}://${req.get('host')}`;
    const { url } = await createCheckoutSession(
      email,
      `${base}/dashboard?upgraded=true`,
      `${base}/run/${req.body?.jobId || ''}?cancelled=true`,
    );
    res.json({ ok: true, url });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'checkout failed' });
  }
});

const rawStripe = express.raw({ type: 'application/json', limit: '4mb' });
app.post('/api/billing/webhook', rawStripe, async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!sig || typeof sig !== 'string') {
    res.status(400).json({ error: 'missing stripe-signature header' });
    return;
  }

  try {
    await handleStripeWebhook(req.body as Buffer, sig);
    res.json({ ok: true });
  } catch (err) {
    console.error('[stripe webhook]', err instanceof Error ? err.message : err);
    res.status(400).json({ error: 'webhook verification failed' });
  }
});

app.get('/api/billing/status', async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  if (!email) {
    res.status(400).json({ error: 'email query param required' });
    return;
  }

  const subscription = await getSubscriptionStatus(email);
  res.json(subscription);
});

// --- Monitoring endpoints (pro users) ---

app.get('/api/monitors', async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  if (!email) { res.status(400).json({ error: 'email required' }); return; }

  const sub = await getSubscriptionStatus(email);
  const monitors = await getMonitors(email);
  res.json({ monitors, plan: sub.plan });
});

app.post('/api/monitors', jsonBody, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const intervalHours = typeof req.body?.intervalHours === 'number' ? req.body.intervalHours : 24;

  if (!email || !url) {
    res.status(400).json({ error: 'email and url are required' });
    return;
  }

  try { new URL(url); } catch {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  const sub = await getSubscriptionStatus(email);
  if (!sub.active) {
    res.status(403).json({ error: 'Pro plan required for monitoring' });
    return;
  }

  const monitors = await addMonitor(email, url, intervalHours);
  res.json({ ok: true, monitors });
});

app.delete('/api/monitors', jsonBody, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!email || !url) { res.status(400).json({ error: 'email and url required' }); return; }

  const monitors = await removeMonitor(email, url);
  res.json({ ok: true, monitors });
});

app.patch('/api/monitors', jsonBody, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined;
  if (!email || !url || enabled === undefined) {
    res.status(400).json({ error: 'email, url, and enabled are required' });
    return;
  }

  const monitors = await toggleMonitor(email, url, enabled);
  res.json({ ok: true, monitors });
});

registerConsoleRoutes(app, jsonBody);

app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.listen(CONFIG.port, () => {
  console.log(`autobot API server running at http://localhost:${CONFIG.port}`);
});
