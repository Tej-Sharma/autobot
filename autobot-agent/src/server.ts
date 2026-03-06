import express from 'express';
import { cloneRepo } from './cloneRunner';
import { installDeps } from './installRunner';
import { dockerUp, dockerDown } from './dockerRunner';
import { startDevServer, stopDevServer } from './devServer';
import { detectProject } from './projectDetector';
import { captureScreenshots } from './screenshotRunner';
import { runAiTest } from './aiTestRunner';
import { getHealth } from './healthCheck';
import { runAgentLoop } from './agentLoop';
import { TaskWorker } from './taskWorker';
import {
  AiTestRequest,
  AgentConfig,
  CloneRequest,
  InstallRequest,
  DockerUpRequest,
  StartRequest,
  ScreenshotRequest,
} from './types';

const app = express();
const PORT = parseInt(process.env.PORT ?? '8080', 10);
const AGENT_SECRET = process.env.AUTOBOT_AGENT_SECRET ?? '';

app.use(express.json({ limit: '50mb' }));

/* ------------------------------------------------------------------ */
/*  Auth middleware                                                     */
/* ------------------------------------------------------------------ */

const verifyAuth = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  // Health endpoint is unauthenticated (used by Fly health checks)
  if (req.path === '/health') {
    next();
    return;
  }

  if (!AGENT_SECRET) {
    // No secret configured — allow all (dev mode)
    next();
    return;
  }

  const header = req.headers.authorization;
  if (!header || header !== `Bearer ${AGENT_SECRET}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
};

app.use(verifyAuth);

/* ------------------------------------------------------------------ */
/*  Endpoints                                                          */
/* ------------------------------------------------------------------ */

app.get('/health', (_req, res) => {
  res.json(getHealth());
});

app.post('/clone', async (req, res) => {
  const body = req.body as CloneRequest;
  if (!body.repoUrl || !body.branch) {
    res.status(400).json({ error: 'repoUrl and branch are required' });
    return;
  }
  const result = await cloneRepo(body);
  res.status(result.success ? 200 : 500).json(result);
});

app.post('/install', async (req, res) => {
  const body = req.body as InstallRequest;
  const result = await installDeps(body);
  res.status(result.success ? 200 : 500).json(result);
});

app.post('/docker-up', async (req, res) => {
  const body = req.body as DockerUpRequest;
  const result = await dockerUp(body);
  res.status(result.success ? 200 : 500).json(result);
});

app.post('/docker-down', async (_req, res) => {
  await dockerDown();
  res.json({ ok: true });
});

app.post('/start', async (req, res) => {
  const body = req.body as StartRequest;
  const result = await startDevServer(body);
  res.status(result.success ? 200 : 500).json(result);
});

app.post('/stop', async (_req, res) => {
  await stopDevServer();
  await dockerDown();
  res.json({ ok: true });
});

app.get('/detect', (_req, res) => {
  try {
    const config = detectProject();
    res.json(config);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'detection failed',
    });
  }
});

app.post('/screenshot', async (req, res) => {
  const body = req.body as ScreenshotRequest;
  if (!body.routes?.length || !body.viewports?.length) {
    res.status(400).json({ error: 'routes and viewports are required' });
    return;
  }
  const result = await captureScreenshots(body);
  res.status(result.success ? 200 : 500).json(result);
});

app.post('/run-ai-test', async (req, res) => {
  const body = req.body as AiTestRequest;
  if (!body.mode || (body.mode !== 'agentic' && body.mode !== 'scriptgen')) {
    res.status(400).json({ error: 'mode must be "agentic" or "scriptgen"' });
    return;
  }
  const result = await runAiTest(body);
  res.status(result.success ? 200 : 500).json(result);
});

/* ------------------------------------------------------------------ */
/*  Agent chat endpoint (SSE streaming)                                */
/* ------------------------------------------------------------------ */

app.post('/agent/chat', async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  const agentConfig: AgentConfig = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    userApiKey: process.env.USER_API_KEY ?? '',
    mcpServerUrl: process.env.CONSTELLA_BACKEND_URL ?? 'https://fastfind.app',
    model: process.env.AGENT_MODEL,
    maxBudgetUsd: parseFloat(process.env.AGENT_MAX_BUDGET_USD ?? '5'),
    userTimezone: (req.body as any).timezone ?? 'UTC',
  };

  if (!agentConfig.anthropicApiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    for await (const event of runAgentLoop(agentConfig, message)) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (err) {
    const errorEvent = {
      type: 'error',
      data: { error: err instanceof Error ? err.message : String(err) },
    };
    res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
  }

  res.end();
});

/* ------------------------------------------------------------------ */
/*  404 + start                                                        */
/* ------------------------------------------------------------------ */

app.use((_req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.listen(PORT, () => {
  console.log(`[autobot-agent] running on port ${PORT}`);

  // Start the background task worker if env vars are configured
  const userApiKey = process.env.USER_API_KEY ?? '';
  const userId = process.env.USER_ID ?? '';
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? '';

  if (userApiKey && userId && anthropicApiKey) {
    const worker = new TaskWorker({
      backendUrl: process.env.CONSTELLA_BACKEND_URL ?? 'https://fastfind.app',
      machineSecret: AGENT_SECRET,
      userId,
      userApiKey,
      anthropicApiKey,
      model: process.env.AGENT_MODEL,
      pollIntervalMs: 5000,
    });
    worker.start();
    console.log('[autobot-agent] Task worker started');
  } else {
    console.log('[autobot-agent] Task worker not started (missing USER_API_KEY, USER_ID, or ANTHROPIC_API_KEY)');
  }
});
