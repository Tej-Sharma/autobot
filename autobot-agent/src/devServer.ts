import { ChildProcess, spawn } from 'node:child_process';
import http from 'node:http';
import { getRepoDir } from './cloneRunner';
import { detectProject } from './projectDetector';
import { StartRequest, StartResult } from './types';

let serverProcess: ChildProcess | null = null;
let currentPort: number | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isPortReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function startDevServer(req: StartRequest): Promise<StartResult> {
  const start = Date.now();
  const repoDir = getRepoDir();

  try {
    // Stop existing if running
    await stopDevServer();

    const project = detectProject();
    const command = req.command ?? project.startCommand;
    const port = req.port ?? project.devServerPort;

    // Parse command into parts
    const [cmd, ...args] = command.split(/\s+/);

    serverProcess = spawn(cmd, args, {
      cwd: repoDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'development',
      },
      detached: false,
      shell: true,
    });

    currentPort = port;

    serverProcess.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(`[devServer] ${chunk.toString()}`);
    });

    serverProcess.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[devServer:err] ${chunk.toString()}`);
    });

    serverProcess.on('exit', (code) => {
      console.log(`[devServer] process exited with code ${code}`);
      serverProcess = null;
      currentPort = null;
    });

    // Wait for server to be ready (poll localhost:port)
    const timeoutMs = 180_000; // 3 minutes
    const pollStart = Date.now();
    while (Date.now() - pollStart < timeoutMs) {
      if (await isPortReady(port)) {
        return {
          success: true,
          port,
          url: `http://localhost:${port}`,
          pid: serverProcess.pid ?? 0,
          durationMs: Date.now() - start,
        };
      }
      // Check if process died
      if (serverProcess === null) {
        return {
          success: false,
          port,
          url: '',
          pid: 0,
          durationMs: Date.now() - start,
          error: 'Dev server process exited before becoming ready',
        };
      }
      await sleep(1000);
    }

    // Timed out
    await stopDevServer();
    return {
      success: false,
      port,
      url: '',
      pid: 0,
      durationMs: Date.now() - start,
      error: `Dev server did not become ready within ${timeoutMs / 1000}s`,
    };
  } catch (err) {
    return {
      success: false,
      port: 0,
      url: '',
      pid: 0,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'failed to start dev server',
    };
  }
}

export async function stopDevServer(): Promise<void> {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    // Give it 5s to shut down, then force kill
    await sleep(5000);
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGKILL');
    }
  }
  serverProcess = null;
  currentPort = null;
}

export function isDevServerRunning(): boolean {
  return serverProcess !== null && !serverProcess.killed;
}

export function getDevServerPort(): number | null {
  return currentPort;
}
