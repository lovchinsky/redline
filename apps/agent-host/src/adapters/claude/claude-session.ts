import {
  query,
  type HookCallbackMatcher,
  type Options,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { agentReportSchema } from '@redline/agent-protocol';
import { readFile } from 'node:fs/promises';
import * as z from 'zod/mini';
import type { PromptPart } from '../../domain/prompt';
import type { SessionEnd, SessionResult } from '../../domain/session';
import type { AgentSession, SessionActivity, SessionRequest } from '../../ports/agent';

/** The agent's tools: Claude Code's own, without the web and without asking questions. */
const TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'TodoWrite'];

const REPORT_SCHEMA = z.toJSONSchema(agentReportSchema);

/** The most telling field of a tool's input, for the journal. */
const targetOf = (input: unknown): string => {
  if (typeof input !== 'object' || input === null) return '';
  const fields = input as Record<string, unknown>;
  for (const key of ['file_path', 'notebook_path', 'path', 'pattern', 'command']) {
    const value = fields[key];
    if (typeof value === 'string') return value.split('\n')[0] ?? '';
  }
  return '';
};

const endOf = (result: SDKResultMessage): SessionEnd => {
  switch (result.subtype) {
    case 'success': {
      if (result.is_error) {
        return {
          kind: 'api-error',
          status: result.api_error_status ?? null,
          detail: result.result,
        };
      }
      const report = agentReportSchema.safeParse(result.structured_output);
      return { kind: 'completed', report: report.success ? report.data : null };
    }
    case 'error_max_turns':
      return { kind: 'max-turns' };
    case 'error_max_budget_usd':
      return { kind: 'budget' };
    case 'error_max_structured_output_retries':
      return { kind: 'completed', report: null };
    case 'error_during_execution':
      return { kind: 'error', detail: result.errors.join('; ') || 'The session failed' };
  }
};

/**
 * The coding agent as the Claude Agent SDK runs it: Claude Code in the workspace, its project
 * settings and CLAUDE.md loaded, permissions decided without asking anyone, and a structured
 * report at the end.
 */
export class ClaudeSession implements AgentSession {
  constructor(
    private readonly options: {
      /** The environment of Claude Code: where the model is and the run's grant. */
      readonly env: Record<string, string | undefined>;
      readonly workspace: string;
      /** Claude Code's configuration directory: the session's transcript lives there. */
      readonly sessionDir: string;
      readonly query?: typeof query;
      readonly readImage?: (path: string) => Promise<Buffer>;
    },
  ) {}

  async run(request: SessionRequest, signal: AbortSignal): Promise<SessionResult> {
    const first = () => this.firstMessage(request.prompt);
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
    };
    signal.addEventListener('abort', abort, { once: true });
    const session = (this.options.query ?? query)({
      prompt: (async function* () {
        yield await first();
      })(),
      options: this.optionsFor(request, controller),
    });
    const started = Date.now();
    let result: SDKResultMessage | null = null;
    try {
      for await (const item of session) {
        this.observe(item, request.onActivity);
        if (item.type === 'result') {
          result = item;
          break;
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        return {
          end: { kind: 'error', detail: String(error) },
          usage: { turns: 0, durationMs: Date.now() - started, costUsd: 0 },
        };
      }
    } finally {
      signal.removeEventListener('abort', abort);
      session.close();
    }
    if (result === null) {
      // Stopped from outside: whoever aborted knows why.
      return {
        end: { kind: 'error', detail: 'The session ended without a result' },
        usage: { turns: 0, durationMs: Date.now() - started, costUsd: 0 },
      };
    }
    return {
      end: endOf(result),
      usage: {
        turns: result.num_turns,
        durationMs: result.duration_ms,
        costUsd: result.total_cost_usd,
      },
    };
  }

  private optionsFor(request: SessionRequest, controller: AbortController): Options {
    const guard: HookCallbackMatcher = {
      hooks: [
        (input) => {
          if (input.hook_event_name !== 'PreToolUse') return Promise.resolve({});
          const decision = request.judge(input.tool_name, input.tool_input);
          if (decision.allow) return Promise.resolve({});
          request.onActivity({ kind: 'denied', tool: input.tool_name, reason: decision.reason });
          return Promise.resolve({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: decision.reason,
            },
          });
        },
      ],
    };
    return {
      cwd: this.options.workspace,
      model: request.model,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: request.rules },
      // The project's CLAUDE.md and settings: what its team tells any agent about the code.
      settingSources: ['project'],
      tools: TOOLS,
      allowedTools: TOOLS,
      // Nobody is there to answer a permission prompt: what is not allowed is denied.
      permissionMode: 'dontAsk',
      permissionPrompts: 'none',
      hooks: { PreToolUse: [guard] },
      maxTurns: request.maxTurns,
      ...(request.budgetUsd === null ? {} : { maxBudgetUsd: request.budgetUsd }),
      outputFormat: { type: 'json_schema', schema: REPORT_SCHEMA },
      // Text the receiver wrote from page material: delivered as written, never expanded.
      verbatimPrompts: true,
      strictMcpConfig: true,
      env: {
        ...this.options.env,
        CLAUDE_CONFIG_DIR: this.options.sessionDir,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_AGENT_SDK_CLIENT_APP: 'redline-agent-host/0.1.0',
      },
      abortController: controller,
    };
  }

  private observe(message: SDKMessage, onActivity: (activity: SessionActivity) => void): void {
    if (message.type === 'system' && message.subtype === 'init') {
      onActivity({ kind: 'started', model: message.model });
      return;
    }
    if (message.type !== 'assistant' || message.parent_tool_use_id !== null) return;
    for (const block of message.message.content) {
      if (block.type === 'text' && block.text.trim() !== '') {
        onActivity({ kind: 'turn', text: block.text });
      } else if (block.type === 'tool_use') {
        onActivity({ kind: 'tool', tool: block.name, target: targetOf(block.input) });
      }
    }
  }

  private async firstMessage(prompt: readonly PromptPart[]): Promise<SDKUserMessage> {
    const read = this.options.readImage ?? ((path: string) => readFile(path));
    const content = await Promise.all(
      prompt.map(async (part) =>
        part.kind === 'text'
          ? { type: 'text' as const, text: part.text }
          : {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: part.mediaType,
                data: (await read(part.path)).toString('base64'),
              },
            },
      ),
    );
    return { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
  }
}
