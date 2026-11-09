import { describe, expect, it } from 'vitest';
import { UsageMeter } from './usage-meter';

const encoder = new TextEncoder();

describe('UsageMeter', () => {
  it('reads a stream’s usage however its bytes are cut', () => {
    const stream = [
      'event: message_start\n',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_creation_input_tokens":4,"cache_read_input_tokens":90,"output_tokens":1}}}\n\n',
      'event: message_delta\n',
      'data: {"type":"message_delta","usage":{"output_tokens":7}}\n\n',
      'event: message_delta\n',
      'data: {"type":"message_delta","usage":{"output_tokens":25}}',
    ].join('');
    for (const size of [1, 7, 64, stream.length]) {
      const meter = new UsageMeter('stream');
      const bytes = encoder.encode(stream);
      for (let i = 0; i < bytes.length; i += size) meter.push(bytes.slice(i, i + size));
      expect(meter.finish()).toEqual({ input: 10, output: 25, cacheWrite: 4, cacheRead: 90 });
    }
  });

  it('reads a JSON answer, and nothing from an answer without usage', () => {
    const json = new UsageMeter('json');
    json.push(encoder.encode('{"type":"message","usage":{"input_tokens":3,'));
    json.push(encoder.encode('"output_tokens":4}}'));
    expect(json.finish()).toEqual({ input: 3, output: 4, cacheWrite: 0, cacheRead: 0 });
    const none = new UsageMeter('stream');
    none.push(encoder.encode('event: ping\ndata: {"type":"ping"}\n\n'));
    expect(none.finish()).toBeNull();
  });
});
