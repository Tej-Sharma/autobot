/**
 * Agent Loop — core agentic loop for the Fly machine.
 *
 * Uses the Anthropic SDK directly to create a tool-use conversation loop.
 * Combines local tools (bash, file I/O, git, QA) with remote MCP tools
 * (user data, integrations, task management) via the MCP client.
 *
 * The loop:
 *   1. Filters tools via RAG (filter_available_tools MCP call)
 *   2. Sends user message + tools to Claude
 *   3. Executes tool calls (local or remote)
 *   4. Appends tool results and loops until stop_reason === "end_turn"
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
  TextBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { McpClient, mcpToolsToAnthropicFormat, type McpToolSchema } from './mcpClient';
import { LOCAL_TOOLS, LOCAL_TOOL_NAMES, executeLocalTool } from './localTools';
import type { AgentConfig, AgentEvent } from './types';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const MAX_TURNS = 100;
const MAX_TOOL_RESULT_LENGTH = 100_000;

/* ------------------------------------------------------------------ */
/*  Cost estimation                                                    */
/* ------------------------------------------------------------------ */

const COST_PER_1K: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5-20251001': { input: 0.0008, output: 0.004 },
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
};

function estimateCost(
  usage: { input_tokens: number; output_tokens: number },
  model: string,
): number {
  const rates = COST_PER_1K[model] ?? COST_PER_1K[DEFAULT_MODEL];
  return (
    (usage.input_tokens / 1000) * rates.input +
    (usage.output_tokens / 1000) * rates.output
  );
}

/* ------------------------------------------------------------------ */
/*  System prompt                                                      */
/* ------------------------------------------------------------------ */

function buildSystemPrompt(config: AgentConfig): string {
  const parts = [
    'You are an AI agent running on a dedicated machine for this user.',
    'You have access to local tools (bash, file operations, git, QA testing) and remote tools (user data, integrations, task management).',
    '',
    'Guidelines:',
    '- Execute tasks step by step, using tools as needed.',
    '- When you need to search the user\'s notes or data, use retrieve_info_to_respond_to_user.',
    '- For long-running tasks, use update_task_progress to report progress.',
    '- When a task is complete, use complete_task to mark it done.',
    '- Be concise in your responses. Focus on results, not process.',
    '- If you encounter an error, try to fix it or explain clearly what went wrong.',
    '',
    'Working directory: /workspace',
    'Repository directory: /workspace/repo',
  ];

  if (config.systemPrompt) {
    parts.push('', '--- Custom Instructions ---', config.systemPrompt);
  }

  return parts.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Tool filtering                                                     */
/* ------------------------------------------------------------------ */

async function getFilteredTools(
  mcp: McpClient,
  message: string,
): Promise<McpToolSchema[]> {
  try {
    const tools = await mcp.filterTools(message, 30);
    if (tools.length > 0) return tools;
  } catch (err) {
    console.error('[agentLoop] filterTools failed, falling back to listTools:', err);
  }

  // Fallback: list all tools
  try {
    return await mcp.listTools();
  } catch (err) {
    console.error('[agentLoop] listTools failed:', err);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Agent loop                                                         */
/* ------------------------------------------------------------------ */

export async function* runAgentLoop(
  config: AgentConfig,
  message: string,
  conversationHistory?: MessageParam[],
): AsyncGenerator<AgentEvent> {
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const mcp = new McpClient(
    config.mcpServerUrl || 'https://fastfind.app',
    config.userApiKey,
  );
  const model = config.model || DEFAULT_MODEL;
  const maxBudget = config.maxBudgetUsd ?? 5;
  let totalCost = 0;

  yield { type: 'status', data: { status: 'filtering_tools', message: 'Selecting relevant tools...' } };

  // 1. Filter tools by relevance
  const filteredRemoteTools = await getFilteredTools(mcp, message);
  const remoteToolSchemas = mcpToolsToAnthropicFormat(filteredRemoteTools);

  // 2. Combine local + remote tools
  const allTools = [...LOCAL_TOOLS, ...remoteToolSchemas];

  yield {
    type: 'status',
    data: {
      status: 'tools_ready',
      message: `${LOCAL_TOOLS.length} local + ${remoteToolSchemas.length} remote tools`,
    },
  };

  // 3. Build conversation
  const messages: MessageParam[] = conversationHistory
    ? [...conversationHistory, { role: 'user', content: message }]
    : [{ role: 'user', content: message }];

  const systemPrompt = buildSystemPrompt(config);

  // 4. Agentic loop
  let turns = 0;

  while (turns < MAX_TURNS && totalCost < maxBudget) {
    turns++;

    let response: Anthropic.Messages.Message;
    try {
      response = await anthropic.messages.create({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages,
        tools: allTools,
      });
    } catch (err) {
      yield {
        type: 'error',
        data: { error: `API error: ${err instanceof Error ? err.message : String(err)}` },
      };
      break;
    }

    const turnCost = estimateCost(response.usage, model);
    totalCost += turnCost;

    // Process response blocks
    const toolUseBlocks: ToolUseBlock[] = [];
    const assistantContent: Array<TextBlock | ToolUseBlock> = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        assistantContent.push(block);
        if (block.text.trim()) {
          yield { type: 'text', data: { text: block.text } };
        }
      } else if (block.type === 'tool_use') {
        assistantContent.push(block);
        toolUseBlocks.push(block);
      }
    }

    // Append assistant message to conversation
    messages.push({ role: 'assistant', content: assistantContent });

    // If no tool calls, we're done
    if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
      yield {
        type: 'done',
        data: { totalCost, turns, stopReason: response.stop_reason },
      };
      break;
    }

    // Execute tool calls
    const toolResults: ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      yield {
        type: 'tool_call',
        data: { tool: toolUse.name, input: toolUse.input },
      };

      let result: string;
      const startTime = Date.now();

      if (LOCAL_TOOL_NAMES.has(toolUse.name)) {
        result = await executeLocalTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
        );
      } else {
        result = await mcp.callTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          config.userTimezone,
        );
      }

      const durationMs = Date.now() - startTime;

      // Truncate very long results
      if (result.length > MAX_TOOL_RESULT_LENGTH) {
        result =
          result.slice(0, MAX_TOOL_RESULT_LENGTH) +
          `\n... (truncated, ${result.length} total chars)`;
      }

      yield {
        type: 'tool_result',
        data: { tool: toolUse.name, result, durationMs },
      };

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    // Append tool results to conversation
    messages.push({ role: 'user', content: toolResults });

    // Budget check
    if (totalCost >= maxBudget) {
      yield {
        type: 'error',
        data: { error: `Budget limit reached: $${totalCost.toFixed(4)} / $${maxBudget}` },
      };
      break;
    }
  }

  if (turns >= MAX_TURNS) {
    yield {
      type: 'error',
      data: { error: `Max turns (${MAX_TURNS}) reached` },
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Single-shot helper (no streaming)                                  */
/* ------------------------------------------------------------------ */

export async function runAgentOnce(
  config: AgentConfig,
  message: string,
): Promise<{ text: string; totalCost: number; turns: number }> {
  let text = '';
  let totalCost = 0;
  let turns = 0;

  for await (const event of runAgentLoop(config, message)) {
    if (event.type === 'text') {
      text += event.data.text;
    } else if (event.type === 'done') {
      totalCost = event.data.totalCost;
      turns = event.data.turns;
    } else if (event.type === 'error') {
      text += `\nError: ${event.data.error}`;
    }
  }

  return { text, totalCost, turns };
}
