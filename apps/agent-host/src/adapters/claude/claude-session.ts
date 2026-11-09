import {
  query,
  type HookCallbackMatcher,
  type Options,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { agentReportSchema } from '@redline/agent-protocol';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import * as z from 'zod/mini';
import { ASK_TOOL, GO_ON, askTurn } from '../../domain/asking';
import type { PromptPart } from '../../domain/prompt';
import type { SessionEnd, SessionResult } from '../../domain/session';
import { isStopReason, type AgentSession, type SessionRequest } from '../../ports/agent';
import { ASKING_VARIABLE, type Asking } from './ask-tool';

/**
 * Claude Code's own tools the agent has: none for the web, and none that waits for a person
 * (the requester is asked through `ask_requester`, which pauses the run instead).
 */
const TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'TodoWrite'];

/** The report's schema in the JSON Schema draft Claude Code validates structured output with. */
const REPORT_SCHEMA = z.toJSONSchema(agentReportSchema, { target: 'draft-7' });

/** The most telling field of a tool's input, for the journal. */
const targetOf = (input: unknown): string => {
  if (typeof input !== 'object' || input === null) return '';
  const fields = input as Record<string, unknown>;
  for (const key of ['file_path', 'path', 'pattern', 'command', 'question']) {
    const value = fields[key];
    if (typeof value === 'string') return value.split('\n')[0] ?? '';
  }
  return '';
};

const endOf = (result: SDKResultMessage): SessionEnd => {
  switch (result.subtype) {
    case 'success': {
      if (result.terminal_reason === 'tool_deferred_unavailable') {
        return {
          kind: 'error',
          detail:
            'The resumed session could not run the call it waited on: ask_requester was not there',
        };
      }
      const deferred = result.deferred_tool_use;
      if (deferred !== undefined && !result.is_error) {
        return deferred.name === ASK_TOOL.qualified
          ? { kind: 'asked', call: deferred.id, input: deferred.input }
          : { kind: 'error', detail: `The session paused on ${deferred.name}, which never pauses` };
      }
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
 * report at the end. The agent asks the requester through `ask_requester`: the call is
 * deferred, which ends the turn and leaves the session waiting on it, and a later process goes
 * on with the session by answering that call. The tool's server (`serveAskTool`) is a process of
 * its own, which Claude Code starts and connects to before the session starts.
 */
export class ClaudeSession implements AgentSession {
  constructor(
    private readonly options: {
      /** The environment of Claude Code: where the model is and the run's grant. */
      readonly env: Record<string, string | undefined>;
      readonly workspace: string;
      /** Claude Code's configuration directory: the session's transcript lives there. */
      readonly sessionDir: string;
      /** How to start the server of `ask_requester` (`serveAskTool`). */
      readonly askTool: { readonly command: string; readonly args: readonly string[] };
      readonly query?: typeof query;
      readonly readImage?: (path: string) => Promise<Buffer>;
    },
  ) {}

  /** Claude Code keeps a session as `projects/<project>/<session id>.jsonl` in its directory. */
  async stored(sessionId: string): Promise<boolean> {
    const projects = path.join(this.options.sessionDir, 'projects');
    let entries: string[];
    try {
      entries = await readdir(projects);
    } catch {
      return false;
    }
    for (const project of entries) {
      try {
        if ((await stat(path.join(projects, project, `${sessionId}.jsonl`))).isFile()) return true;
      } catch {
        // Not in this project.
      }
    }
    return false;
  }

  async run(request: SessionRequest, signal: AbortSignal): Promise<SessionResult> {
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
    };
    signal.addEventListener('abort', abort, { once: true });
    // The input stays open until the session ends: Claude Code takes a closed input for the end
    // of the conversation, and a deferred call then never runs.
    const ended = Promise.withResolvers<undefined>();
    const opening = this.openingOf(request);
    const session = (this.options.query ?? query)({
      prompt: (async function* () {
        const message = await opening;
        if (message !== null) yield message;
        await ended.promise;
      })(),
      options: this.optionsFor(request, controller),
    });
    const started = Date.now();
    let sessionId: string | null = null;
    let result: SDKResultMessage | null = null;
    try {
      for await (const item of session) {
        sessionId = item.session_id ?? sessionId;
        request.onLife();
        this.observe(item, request);
        if (item.type === 'result') {
          result = item;
          break;
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        return {
          end: { kind: 'error', detail: String(error) },
          sessionId,
          usage: { turns: 0, durationMs: Date.now() - started, costUsd: 0 },
        };
      }
    } finally {
      ended.resolve(undefined);
      signal.removeEventListener('abort', abort);
      session.close();
    }
    if (result === null) {
      const reason: unknown = signal.reason;
      return {
        end: isStopReason(reason)
          ? { kind: 'stopped', why: reason }
          : { kind: 'error', detail: 'The session ended without a result' },
        sessionId,
        usage: { turns: 0, durationMs: Date.now() - started, costUsd: 0 },
      };
    }
    return {
      end: endOf(result),
      sessionId,
      usage: {
        turns: result.num_turns,
        durationMs: result.duration_ms,
        costUsd: result.total_cost_usd,
      },
    };
  }

  /**
   * The message the session begins with: the task for a new one; nothing for a resumed one
   * waiting on a call, which goes on with that call's answer; a word to go on for any other.
   */
  private openingOf(request: SessionRequest): Promise<SDKUserMessage | null> {
    const { start } = request;
    if (start.kind === 'new') return this.firstMessage(start.prompt);
    return Promise.resolve(
      start.answer === null
        ? {
            type: 'user',
            message: { role: 'user', content: GO_ON },
            parent_tool_use_id: null,
          }
        : null,
    );
  }

  private optionsFor(request: SessionRequest, controller: AbortController): Options {
    const asking: Asking = {
      pending: request.start.kind === 'resume' ? request.start.answer : null,
      questionsLeft: request.questionsLeft,
    };
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
    // A question pauses the run: the call is deferred, and the turn ends waiting on it.
    const ask: HookCallbackMatcher = {
      matcher: ASK_TOOL.qualified,
      hooks: [
        (input) => {
          if (input.hook_event_name !== 'PreToolUse') return Promise.resolve({});
          const turn = askTurn(input.tool_use_id, input.tool_input, asking);
          return Promise.resolve({
            hookSpecificOutput:
              turn.kind === 'refuse'
                ? {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: turn.reason,
                  }
                : {
                    hookEventName: 'PreToolUse',
                    permissionDecision: turn.kind === 'pause' ? 'defer' : 'allow',
                  },
          });
        },
      ],
    };
    const tools = [...TOOLS, ASK_TOOL.qualified];
    return {
      cwd: this.options.workspace,
      model: request.model,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: request.rules },
      // The project's CLAUDE.md and settings: what its team tells any agent about the code.
      settingSources: ['project'],
      tools: TOOLS,
      mcpServers: {
        [ASK_TOOL.server]: {
          type: 'stdio',
          command: this.options.askTool.command,
          args: [...this.options.askTool.args],
          env: { [ASKING_VARIABLE]: JSON.stringify(asking) },
          // Connected before the session starts: a resumed session runs its deferred call at
          // once, and drops it when the tool is not there yet.
          alwaysLoad: true,
        },
      },
      allowedTools: tools,
      // Nobody is there to answer a permission prompt: what is not allowed is denied.
      permissionMode: 'dontAsk',
      permissionPrompts: 'none',
      hooks: { PreToolUse: [guard, ask] },
      ...(request.start.kind === 'resume' ? { resume: request.start.sessionId } : {}),
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

  private observe(message: SDKMessage, request: SessionRequest): void {
    const { onActivity } = request;
    if (message.type === 'system' && message.subtype === 'init') {
      onActivity({
        kind: 'started',
        model: message.model,
        resumed: request.start.kind === 'resume',
      });
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
