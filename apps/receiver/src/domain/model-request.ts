/**
 * Which model requests a run may make. The sandbox reaches the outside world only through the
 * model, so a request is judged by what it would make the model's provider do on the run's
 * behalf: run a server tool, call an MCP server, use a container, or fetch a URL or a stored
 * file named in the conversation. Each of those is a way out; none is allowed.
 */
export interface ModelRequestRules {
  readonly models: readonly string[];
  readonly maxTokens: number;
}

export type ModelRequestVerdict =
  | {
      readonly admitted: true;
      readonly model: string;
      readonly stream: boolean;
      /** The most output the request may ask for: its own limit, or the rules' when it sets none. */
      readonly maxTokens: number;
      /** Its input reckoned on the high side (`inputTokensOf`), before the model counts it. */
      readonly inputTokens: number;
    }
  | { readonly admitted: false; readonly detail: string };

/** Fields of a Messages request that make the provider act beyond the conversation. */
const FORBIDDEN_FIELDS = ['mcp_servers', 'container'] as const;

/**
 * Tool types the client runs itself; any other typed tool runs on the provider's side. A tool
 * without a type, or of type `custom`, is the client's own.
 */
const CLIENT_TOOL_TYPE = /^(custom|bash_\d{8}|text_editor_\d{8}|memory_\d{8})$/;

/** Content sources the provider would fetch: a URL, or a file stored with it. */
const REMOTE_SOURCES = new Set(['url', 'file']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const refuse = (detail: string): ModelRequestVerdict => ({ admitted: false, detail });

/** The first remote source anywhere in `value`, by its JSON path. */
const remoteSource = (value: unknown, path: string): string | null => {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = remoteSource(item, `${path}[${String(index)}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  const source = value['source'];
  if (
    isRecord(source) &&
    typeof source['type'] === 'string' &&
    REMOTE_SOURCES.has(source['type'])
  ) {
    return `${path}.source`;
  }
  for (const [key, item] of Object.entries(value)) {
    const found = remoteSource(item, `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
};

/** Judges a Messages request (`POST /v1/messages` or its `count_tokens`) of a run. */
export const judgeModelRequest = (body: unknown, rules: ModelRequestRules): ModelRequestVerdict => {
  if (!isRecord(body)) return refuse('The request body is not a JSON object');
  const model = body['model'];
  if (typeof model !== 'string' || !rules.models.includes(model)) {
    return refuse(`The run may use ${rules.models.join(', ')}, not ${String(model)}`);
  }
  for (const field of FORBIDDEN_FIELDS) {
    if (field in body) return refuse(`The request may not set ${field}`);
  }
  const maxTokens = body['max_tokens'];
  if (maxTokens !== undefined && (typeof maxTokens !== 'number' || maxTokens > rules.maxTokens)) {
    return refuse(`max_tokens may be at most ${String(rules.maxTokens)}`);
  }
  const tools = body['tools'] ?? [];
  if (!Array.isArray(tools)) return refuse('tools is not a list');
  for (const tool of tools) {
    if (!isRecord(tool)) return refuse('A tool is not an object');
    const type = tool['type'];
    if (type !== undefined && (typeof type !== 'string' || !CLIENT_TOOL_TYPE.test(type))) {
      return refuse(
        `The request may not use the provider's tool ${typeof type === 'string' ? type : JSON.stringify(type)}`,
      );
    }
  }
  for (const field of ['messages', 'system'] as const) {
    const found = remoteSource(body[field], field);
    if (found !== null) return refuse(`The request may not have the provider fetch ${found}`);
  }
  return {
    admitted: true,
    model,
    stream: body['stream'] === true,
    maxTokens: typeof maxTokens === 'number' ? maxTokens : rules.maxTokens,
    inputTokens: inputTokensOf(body),
  };
};

/** Characters of a request per token of its input, reckoned on the high side. */
const CHARACTERS_PER_TOKEN = 3;
/** The most an image costs as input: the model scales an image down to about this many. */
const IMAGE_TOKENS = 1_600;

/**
 * A request's input in tokens, reckoned on the high side: its text by length, and each image at
 * the most an image costs, not by the size of its data.
 */
export const inputTokensOf = (body: unknown): number => {
  let images = 0;
  const text = JSON.stringify(body, (_key, value: unknown) => {
    if (isRecord(value) && value['type'] === 'image') {
      images += 1;
      return { type: 'image' };
    }
    return value;
  });
  return Math.ceil(text.length / CHARACTERS_PER_TOKEN) + images * IMAGE_TOKENS;
};
