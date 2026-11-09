import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One block of a scripted model's answer. */
export type ScriptedBlock =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    };

/** A request of Claude Code to the model, as the script sees it. */
export interface ModelRequest {
  readonly tools: readonly string[];
  /** Every block of the conversation so far, flattened, in order. */
  readonly blocks: readonly Record<string, unknown>[];
}

type Script = (request: ModelRequest) => {
  readonly blocks: readonly ScriptedBlock[];
  readonly stop: 'end_turn' | 'tool_use';
};

const event = (type: string, data: Record<string, unknown>) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

const streamOf = (model: string, blocks: readonly ScriptedBlock[], stop: string, id: number) => {
  const events = [
    event('message_start', {
      message: {
        id: `msg_${String(id)}`,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    }),
  ];
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      events.push(
        event('content_block_start', { index, content_block: { type: 'text', text: '' } }),
      );
      events.push(
        event('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } }),
      );
    } else {
      events.push(
        event('content_block_start', {
          index,
          content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
        }),
      );
      events.push(
        event('content_block_delta', {
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
        }),
      );
    }
    events.push(event('content_block_stop', { index }));
  });
  events.push(
    event('message_delta', {
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: 5 },
    }),
  );
  events.push(event('message_stop', {}));
  return events.join('');
};

const blocksOf = (messages: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message: { content?: unknown }) =>
    typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : Array.isArray(message.content)
        ? (message.content as Record<string, unknown>[])
        : [],
  );
};

/**
 * A stand-in for the Messages API that answers Claude Code by `script`: enough of the protocol
 * (streamed messages) for Claude Code to run a session against it, with no model behind it.
 * Requests that are not for a message (e.g. token counts) get an empty answer.
 */
export const scriptedMessagesApi = async (
  script: Script,
): Promise<{ readonly url: string; close(): Promise<void> }> => {
  let answered = 0;
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const path = request.url ?? '';
      if (!path.startsWith('/v1/messages') || path.includes('count_tokens')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ input_tokens: 10 }));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        model: string;
        tools?: { name: string }[];
        messages?: unknown;
      };
      const answer = script({
        tools: (body.tools ?? []).map((tool) => tool.name),
        blocks: blocksOf(body.messages),
      });
      answered += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(streamOf(body.model, answer.blocks, answer.stop, answered));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
};
