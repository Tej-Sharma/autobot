/**
 * Local Tools — tool definitions + execution for the Fly machine agent.
 *
 * These tools run directly on the machine (bash, file I/O, git, QA testing).
 * The agent loop calls executeLocalTool() for any tool whose name is in
 * LOCAL_TOOL_NAMES. Everything else is dispatched to the MCP server.
 */

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Tool as AnthropicTool } from '@anthropic-ai/sdk/resources/messages';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const WORKSPACE = '/workspace';
const MAX_BASH_TIMEOUT = 300_000; // 5 minutes
const MAX_FILE_READ_LINES = 5000;

/* ------------------------------------------------------------------ */
/*  Tool schemas (Anthropic SDK format)                                */
/* ------------------------------------------------------------------ */

export const LOCAL_TOOLS: AnthropicTool[] = [
  {
    name: 'bash',
    description:
      'Execute a bash command on the machine. Use for installing packages, running scripts, git operations, docker commands, etc. Commands run in /workspace by default.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute',
        },
        timeout_ms: {
          type: 'number',
          description: `Timeout in milliseconds (default 120000, max ${MAX_BASH_TIMEOUT})`,
        },
        cwd: {
          type: 'string',
          description: 'Working directory (default /workspace)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'file_read',
    description:
      'Read the contents of a file. Returns the file content with line numbers. For large files, use offset and limit to read a specific range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file to read',
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (1-based, default 1)',
        },
        limit: {
          type: 'number',
          description: `Maximum number of lines to return (default ${MAX_FILE_READ_LINES})`,
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'file_write',
    description:
      'Write content to a file, creating it if it does not exist. Creates parent directories automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file to write',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'file_edit',
    description:
      'Perform a search-and-replace in a file. The old_string must appear exactly once in the file (unless replace_all is true).',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file to edit',
        },
        old_string: {
          type: 'string',
          description: 'The exact text to find and replace',
        },
        new_string: {
          type: 'string',
          description: 'The replacement text',
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace all occurrences (default false)',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'git_clone',
    description:
      'Clone a git repository into /workspace/repo. If the repo is already cloned, fetches and checks out the specified branch.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo_url: {
          type: 'string',
          description: 'The git repository URL (e.g. https://github.com/owner/repo.git)',
        },
        branch: {
          type: 'string',
          description: 'The branch to clone/checkout',
        },
        sha: {
          type: 'string',
          description: 'Specific commit SHA to checkout (optional)',
        },
        access_token: {
          type: 'string',
          description: 'GitHub access token for private repos (optional)',
        },
      },
      required: ['repo_url', 'branch'],
    },
  },
  {
    name: 'run_qa_test',
    description:
      'Run AI-powered QA testing on the currently cloned repository. The dev server must be running first. Returns a test report with findings.',
    input_schema: {
      type: 'object' as const,
      properties: {
        mode: {
          type: 'string',
          enum: ['agentic', 'scriptgen'],
          description: 'Testing mode: "agentic" (AI browser control) or "scriptgen" (generate+execute Playwright scripts)',
        },
        budget: {
          type: 'number',
          description: 'Maximum budget in USD for the test run (default 3)',
        },
        credentials: {
          type: 'object',
          description: 'Login credentials for authenticated testing (e.g. {email: "...", password: "..."})',
        },
        base_url: {
          type: 'string',
          description: 'Override the dev server URL (default: auto-detected from running dev server)',
        },
        force_analysis: {
          type: 'boolean',
          description: 'Force re-analysis of the codebase even if cached (default false)',
        },
      },
      required: ['mode'],
    },
  },
  {
    name: 'glob',
    description:
      'Find files matching a glob pattern. Returns matching file paths sorted by modification time.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.test.js")',
        },
        cwd: {
          type: 'string',
          description: 'Directory to search in (default /workspace/repo)',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep',
    description:
      'Search file contents for a regex pattern. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for',
        },
        path: {
          type: 'string',
          description: 'File or directory to search in (default /workspace/repo)',
        },
        include: {
          type: 'string',
          description: 'Glob filter for files to include (e.g. "*.ts")',
        },
      },
      required: ['pattern'],
    },
  },
];

export const LOCAL_TOOL_NAMES = new Set(LOCAL_TOOLS.map((t) => t.name));

/* ------------------------------------------------------------------ */
/*  Tool implementations                                               */
/* ------------------------------------------------------------------ */

function executeBash(input: {
  command: string;
  timeout_ms?: number;
  cwd?: string;
}): string {
  const timeout = Math.min(input.timeout_ms ?? 120_000, MAX_BASH_TIMEOUT);
  const cwd = input.cwd ?? WORKSPACE;

  try {
    const output = execSync(input.command, {
      cwd,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });
    return output.length > 50_000
      ? output.slice(0, 50_000) + '\n... (output truncated)'
      : output;
  } catch (err: any) {
    const stdout = err.stdout ?? '';
    const stderr = err.stderr ?? '';
    const exitCode = err.status ?? 1;
    const combined = `Exit code: ${exitCode}\n${stdout}\n${stderr}`.trim();
    return combined.length > 50_000
      ? combined.slice(0, 50_000) + '\n... (output truncated)'
      : combined;
  }
}

function executeFileRead(input: {
  path: string;
  offset?: number;
  limit?: number;
}): string {
  const filePath = input.path;
  if (!fs.existsSync(filePath)) {
    return `Error: File not found: ${filePath}`;
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    return `Error: ${filePath} is a directory, not a file`;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const offset = Math.max((input.offset ?? 1) - 1, 0); // convert to 0-based
  const limit = input.limit ?? MAX_FILE_READ_LINES;
  const sliced = lines.slice(offset, offset + limit);

  const numbered = sliced.map(
    (line, i) => `${String(offset + i + 1).padStart(6)} | ${line}`,
  );
  return numbered.join('\n');
}

function executeFileWrite(input: { path: string; content: string }): string {
  const dir = path.dirname(input.path);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(input.path, input.content, 'utf-8');
  return `File written: ${input.path} (${input.content.length} bytes)`;
}

function executeFileEdit(input: {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}): string {
  if (!fs.existsSync(input.path)) {
    return `Error: File not found: ${input.path}`;
  }

  const content = fs.readFileSync(input.path, 'utf-8');

  if (!content.includes(input.old_string)) {
    return `Error: old_string not found in ${input.path}`;
  }

  if (!input.replace_all) {
    const count = content.split(input.old_string).length - 1;
    if (count > 1) {
      return `Error: old_string appears ${count} times in ${input.path}. Use replace_all=true to replace all, or provide a more specific string.`;
    }
  }

  const newContent = input.replace_all
    ? content.split(input.old_string).join(input.new_string)
    : content.replace(input.old_string, input.new_string);

  fs.writeFileSync(input.path, newContent, 'utf-8');
  return `File edited: ${input.path}`;
}

async function executeGitClone(input: {
  repo_url: string;
  branch: string;
  sha?: string;
  access_token?: string;
}): Promise<string> {
  // Delegate to the existing cloneRepo function
  const { cloneRepo } = await import('./cloneRunner');
  const result = await cloneRepo({
    repoUrl: input.repo_url,
    branch: input.branch,
    sha: input.sha,
    accessToken: input.access_token,
  });

  if (result.success) {
    return `Repository cloned successfully.\nSHA: ${result.sha}\nFresh clone: ${result.cloned}\nDuration: ${result.durationMs}ms`;
  }
  return `Error cloning repository: ${result.error}`;
}

async function executeRunQaTest(input: {
  mode: 'agentic' | 'scriptgen';
  budget?: number;
  credentials?: Record<string, string>;
  base_url?: string;
  force_analysis?: boolean;
}): Promise<string> {
  // Delegate to the existing runAiTest function
  const { runAiTest } = await import('./aiTestRunner');
  const result = await runAiTest({
    mode: input.mode,
    budget: input.budget,
    credentials: input.credentials,
    baseUrl: input.base_url,
    forceAnalysis: input.force_analysis,
  });

  if (result.success && result.report) {
    const r = result.report;
    return [
      `QA Test Complete (${input.mode} mode)`,
      `Status: ${r.status}`,
      `Flows: ${r.flowsPassed}/${r.flowsTotal} passed, ${r.flowsFailed} failed, ${r.flowsSkipped} skipped`,
      `Code Faults: ${r.codeFaults}`,
      `Cost: $${r.costUsd.toFixed(4)}`,
      `Duration: ${(r.durationMs / 1000).toFixed(1)}s`,
      `Screenshots: ${r.screenshotKeys.length}`,
      '',
      r.findings.length > 0
        ? `Findings:\n${r.findings.map((f) => `  [${f.severity}] ${f.category}: ${f.message}`).join('\n')}`
        : 'No findings.',
      '',
      r.reportMd ? `Full Report:\n${r.reportMd}` : '',
    ].join('\n');
  }

  return `QA Test Failed: ${result.error ?? 'Unknown error'}`;
}

function executeGlob(input: {
  pattern: string;
  cwd?: string;
}): string {
  const cwd = input.cwd ?? path.join(WORKSPACE, 'repo');
  try {
    // Use find + fnmatch via bash for glob matching
    const output = execSync(
      `find . -path './.git' -prune -o -path './node_modules' -prune -o -type f -print | sort`,
      { cwd, encoding: 'utf-8', timeout: 30_000, maxBuffer: 5 * 1024 * 1024 },
    );

    // Filter with minimatch-style pattern matching
    const { minimatch } = requireMinimatch();
    const files = output
      .split('\n')
      .filter(Boolean)
      .map((f) => f.replace(/^\.\//, ''))
      .filter((f) => minimatch(f, input.pattern));

    if (files.length === 0) {
      return `No files matching pattern: ${input.pattern}`;
    }

    const result = files.slice(0, 500).join('\n');
    return files.length > 500
      ? result + `\n... and ${files.length - 500} more files`
      : result;
  } catch {
    return `Error searching for files matching: ${input.pattern}`;
  }
}

function requireMinimatch(): { minimatch: (file: string, pattern: string) => boolean } {
  try {
    return require('minimatch');
  } catch {
    // Fallback: simple glob matching without minimatch
    return {
      minimatch: (file: string, pattern: string) => {
        const regex = new RegExp(
          '^' +
          pattern
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '<<<GLOBSTAR>>>')
            .replace(/\*/g, '[^/]*')
            .replace(/<<<GLOBSTAR>>>/g, '.*')
            .replace(/\?/g, '.') +
          '$',
        );
        return regex.test(file);
      },
    };
  }
}

function executeGrep(input: {
  pattern: string;
  path?: string;
  include?: string;
}): string {
  const searchPath = input.path ?? path.join(WORKSPACE, 'repo');

  try {
    const includeArg = input.include ? `--include='${input.include}'` : '';
    const output = execSync(
      `grep -rn ${includeArg} --exclude-dir=node_modules --exclude-dir=.git -E '${input.pattern.replace(/'/g, "'\\''")}' '${searchPath}' | head -200`,
      { encoding: 'utf-8', timeout: 30_000, maxBuffer: 5 * 1024 * 1024 },
    );

    return output.trim() || `No matches found for pattern: ${input.pattern}`;
  } catch (err: any) {
    if (err.status === 1) {
      return `No matches found for pattern: ${input.pattern}`;
    }
    return `Error searching: ${err.message ?? 'unknown error'}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Dispatcher                                                         */
/* ------------------------------------------------------------------ */

export async function executeLocalTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case 'bash':
        return executeBash(input as any);
      case 'file_read':
        return executeFileRead(input as any);
      case 'file_write':
        return executeFileWrite(input as any);
      case 'file_edit':
        return executeFileEdit(input as any);
      case 'git_clone':
        return await executeGitClone(input as any);
      case 'run_qa_test':
        return await executeRunQaTest(input as any);
      case 'glob':
        return executeGlob(input as any);
      case 'grep':
        return executeGrep(input as any);
      default:
        return `Error: Unknown local tool: ${name}`;
    }
  } catch (err) {
    return `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`;
  }
}
