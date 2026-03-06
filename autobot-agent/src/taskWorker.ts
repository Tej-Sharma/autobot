/**
 * Task Worker — background task polling + execution for the Fly machine.
 *
 * Polls the backend for queued AutonomousTasks assigned to this user's machine.
 * For each task, runs the agent loop with a task-specific system prompt.
 * Reports progress via MCP tools (update_task_progress, complete_task).
 */

import { runAgentLoop } from './agentLoop';
import type { AgentConfig, AgentTaskAssignment, AgentEvent } from './types';

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

export interface TaskWorkerConfig {
  backendUrl: string;           // e.g. https://fastfind.app
  machineSecret: string;        // AUTOBOT_AGENT_SECRET for machine-to-backend auth
  userId: string;
  userApiKey: string;           // csk_ key for MCP tool calls
  anthropicApiKey: string;
  model?: string;
  pollIntervalMs?: number;      // default: 5000
  maxConcurrent?: number;       // default: 1
}

/* ------------------------------------------------------------------ */
/*  Task Worker                                                        */
/* ------------------------------------------------------------------ */

export class TaskWorker {
  private config: TaskWorkerConfig;
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private activeTasks = new Map<string, AbortController>();
  private maxConcurrent: number;
  private pollInterval: number;

  constructor(config: TaskWorkerConfig) {
    this.config = config;
    this.maxConcurrent = config.maxConcurrent ?? 1;
    this.pollInterval = config.pollIntervalMs ?? 5000;
  }

  /* ── Lifecycle ──────────────────────────────────────────────────── */

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[TaskWorker] Started. Polling every', this.pollInterval, 'ms');
    this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    // Abort all active tasks
    for (const [taskId, controller] of this.activeTasks) {
      console.log(`[TaskWorker] Aborting task ${taskId}`);
      controller.abort();
    }
    this.activeTasks.clear();
    console.log('[TaskWorker] Stopped');
  }

  /* ── Polling ────────────────────────────────────────────────────── */

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      if (this.activeTasks.size < this.maxConcurrent) {
        const task = await this.pollForTask();
        if (task) {
          this.executeTask(task);
        }
      }
    } catch (err) {
      console.error('[TaskWorker] Poll error:', err instanceof Error ? err.message : err);
    }

    // Schedule next poll
    if (this.running) {
      this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
    }
  }

  private async pollForTask(): Promise<AgentTaskAssignment | null> {
    const url = `${this.config.backendUrl}/agent/poll-task`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.machineSecret}`,
          'X-User-Id': this.config.userId,
        },
      });

      if (!response.ok) {
        if (response.status !== 204) {
          console.error(`[TaskWorker] Poll failed: HTTP ${response.status}`);
        }
        return null;
      }

      const data = (await response.json()) as { task: AgentTaskAssignment | null };
      return data.task ?? null;
    } catch (err) {
      // Network errors during polling are normal (backend might be restarting)
      return null;
    }
  }

  /* ── Task execution ─────────────────────────────────────────────── */

  private async executeTask(task: AgentTaskAssignment): Promise<void> {
    const taskId = task.taskId;
    console.log(`[TaskWorker] Executing task ${taskId}: ${task.title}`);

    const controller = new AbortController();
    this.activeTasks.set(taskId, controller);

    try {
      // Build task-specific agent config
      const agentConfig: AgentConfig = {
        anthropicApiKey: this.config.anthropicApiKey,
        userApiKey: this.config.userApiKey,
        mcpServerUrl: this.config.backendUrl,
        model: this.config.model,
        maxBudgetUsd: task.config.maxBudgetUsd ?? 5,
        systemPrompt: this.buildTaskSystemPrompt(task),
      };

      // Build the message from the task
      const message = this.buildTaskMessage(task);

      // Run agent loop and collect results
      let finalText = '';
      let totalCost = 0;

      for await (const event of runAgentLoop(agentConfig, message)) {
        if (controller.signal.aborted) {
          console.log(`[TaskWorker] Task ${taskId} was aborted`);
          break;
        }

        switch (event.type) {
          case 'text':
            finalText += event.data.text;
            break;

          case 'tool_call':
            console.log(
              `[TaskWorker] [${taskId}] Tool: ${event.data.tool}`,
            );
            break;

          case 'tool_result':
            // Log tool results briefly
            const preview = String(event.data.result).slice(0, 100);
            console.log(
              `[TaskWorker] [${taskId}] Result (${event.data.durationMs}ms): ${preview}...`,
            );
            break;

          case 'done':
            totalCost = event.data.totalCost;
            console.log(
              `[TaskWorker] [${taskId}] Done. Cost: $${totalCost.toFixed(4)}, Turns: ${event.data.turns}`,
            );
            break;

          case 'error':
            console.error(
              `[TaskWorker] [${taskId}] Error: ${event.data.error}`,
            );
            await this.reportTaskError(taskId, event.data.error);
            break;
        }
      }

      // The agent should have called complete_task via MCP as part of its
      // execution. But if it didn't (e.g. budget exhaustion), we still
      // report what we have.
      console.log(`[TaskWorker] Task ${taskId} finished`);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[TaskWorker] Task ${taskId} failed:`, errMsg);
      await this.reportTaskError(taskId, errMsg);
    } finally {
      this.activeTasks.delete(taskId);
    }
  }

  /* ── Task prompt builders ───────────────────────────────────────── */

  private buildTaskSystemPrompt(task: AgentTaskAssignment): string {
    const parts: string[] = [];

    parts.push(`You are executing an autonomous task (ID: ${task.taskId}).`);
    parts.push(`Task Type: ${task.taskType}`);
    parts.push('');

    if (task.taskType === 'qa_testing') {
      parts.push(
        'You are running QA testing on a repository.',
        'Steps:',
        '1. Call get_task_details to get the full task parameters',
        '2. Call get_github_token to get the GitHub access token',
        '3. Use git_clone to clone the repository',
        '4. Use bash to install dependencies and start the dev server',
        '5. Use run_qa_test to run AI-powered testing',
        '6. Use post_github_comment to post results as a PR comment',
        '7. Call complete_task with a summary when done',
        '',
        'Report progress with update_task_progress throughout.',
      );
    } else {
      parts.push(
        'Execute the task described below. Use the available tools as needed.',
        'Report progress with update_task_progress regularly.',
        'When finished, call complete_task with a summary of what was accomplished.',
      );
    }

    return parts.join('\n');
  }

  private buildTaskMessage(task: AgentTaskAssignment): string {
    const parts = [
      `# Task: ${task.title}`,
      '',
      task.description,
    ];

    if (Object.keys(task.parameters).length > 0) {
      parts.push('', '## Parameters', JSON.stringify(task.parameters, null, 2));
    }

    parts.push('', `Task ID: ${task.taskId}`);
    parts.push('Begin executing this task now.');

    return parts.join('\n');
  }

  /* ── Error reporting ────────────────────────────────────────────── */

  private async reportTaskError(taskId: string, error: string): Promise<void> {
    try {
      const url = `${this.config.backendUrl}/agent/task-error`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.machineSecret}`,
          'X-User-Id': this.config.userId,
        },
        body: JSON.stringify({ task_id: taskId, error }),
      });
    } catch {
      // Best-effort error reporting
    }
  }
}
