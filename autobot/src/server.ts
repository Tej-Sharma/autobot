import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config';
import { RunRequest } from './types';
import { qaQueue } from './queue';
import { parseRunPayload, normalizeRequestForExecution } from './runnerConfig';
import { enqueueRun } from './queue';
import { getJobStatus } from './state';
import { isRepoAllowed, parseWebhookRun } from './github';

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

app.get('/api/qa/jobs/:jobId', async (req, res) => {
  const jobId = req.params.jobId;
  const status = await getJobStatus(jobId);
  if (!status) {
    res.status(404).json({ error: 'job not found' });
    return;
  }

  const base = `${req.protocol}://${req.get('host')}`;
  if (status.reportPath && fs.existsSync(status.reportPath)) {
    try {
      const rawReport = JSON.parse(fs.readFileSync(status.reportPath, 'utf8'));
      res.json({
        ...status,
        report: rawReport,
        reportUrl: `${base}/artifacts/${jobId}/qa-report.json`,
        reportMarkdownUrl: `${base}/artifacts/${jobId}/qa-report.md`,
      });
    } catch {
      res.json({
        ...status,
        reportPath: status.reportPath,
        reportUrl: `${base}/artifacts/${jobId}/qa-report.json`,
        reportMarkdownUrl: `${base}/artifacts/${jobId}/qa-report.md`,
      });
    }
    return;
  }

  res.json({
    ...status,
    reportUrl: `${base}/artifacts/${jobId}/qa-report.json`,
    reportMarkdownUrl: `${base}/artifacts/${jobId}/qa-report.md`,
  });
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

      const request: RunRequest = {
        environment: 'preview',
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

app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.listen(CONFIG.port, () => {
  console.log(`autobot API server running at http://localhost:${CONFIG.port}`);
});
