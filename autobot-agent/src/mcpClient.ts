/**
 * MCP Client — Streamable HTTP transport wrapper.
 *
 * Connects to the Constella MCP server at mcp.fastfind.app using the
 * user's csk_ API key. Provides tool listing and tool execution.
 *
 * Uses plain HTTP POST instead of the MCP SDK to avoid ESM/CJS issues
 * and keep things simple. The Streamable HTTP transport is just HTTP.
 */

import type { Tool as AnthropicTool } from '@anthropic-ai/sdk/resources/messages';

export interface McpToolSchema {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface McpToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export class McpClient {
  private serverUrl: string;
  private apiKey: string;
  private sessionUrl: string | null = null;
  private sessionId: string | null = null;

  constructor(serverUrl: string, apiKey: string) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  /**
   * Call a tool on the MCP server via the backend execute endpoint.
   *
   * Instead of going through the MCP Streamable HTTP transport (which
   * requires the full SDK), we call the backend's REST execute endpoint
   * directly. Both paths end up at the same handler.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    userTimezone: string = 'UTC',
  ): Promise<string> {
    // Call the backend's execute endpoint directly
    const backendUrl = process.env.CONSTELLA_BACKEND_URL || 'https://fastfind.app';
    const url = `${backendUrl}/constella-external-api/mcp/execute`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        tool_name: toolName,
        arguments: args,
        user_timezone: userTimezone,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return JSON.stringify({
        error: `MCP call failed: HTTP ${response.status} — ${text.slice(0, 500)}`,
      });
    }

    const data = (await response.json()) as McpToolResult;
    if (data.success) {
      return typeof data.result === 'string'
        ? data.result
        : JSON.stringify(data.result, null, 2);
    }

    return JSON.stringify({ error: data.error || 'Unknown error' });
  }

  /**
   * List available tools from the MCP server.
   */
  async listTools(userTimezone: string = 'UTC'): Promise<McpToolSchema[]> {
    const backendUrl = process.env.CONSTELLA_BACKEND_URL || 'https://fastfind.app';
    const url = `${backendUrl}/constella-external-api/mcp/tools`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ user_timezone: userTimezone }),
    });

    if (!response.ok) {
      console.error(`[McpClient] Failed to list tools: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as { tools: McpToolSchema[] };
    return data.tools || [];
  }

  /**
   * Filter tools by relevance to a query using RAG.
   */
  async filterTools(query: string, topK: number = 30): Promise<McpToolSchema[]> {
    const backendUrl = process.env.CONSTELLA_BACKEND_URL || 'https://fastfind.app';
    const url = `${backendUrl}/constella-external-api/mcp/filter-tools`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, top_k: topK }),
    });

    if (!response.ok) {
      console.error(`[McpClient] Failed to filter tools: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as { tools: McpToolSchema[] };
    return data.tools || [];
  }
}

/**
 * Convert MCP tool schemas to Anthropic SDK tool format.
 */
export function mcpToolsToAnthropicFormat(tools: McpToolSchema[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description || '',
    input_schema: (t.parameters as AnthropicTool['input_schema']) || {
      type: 'object' as const,
      properties: {},
    },
  }));
}
