import { randomBytes } from 'node:crypto';
import pino from 'pino';
import { RunId, TaskId } from '../../domain/ids';
import type { Clock, IdGenerator, Logger, LogFields } from '../../ports/system';

export const systemClock: Clock = { now: () => Date.now() };

/** 128 random bits in base32 (lowercase, no padding): unguessable, safe in URLs and branch names. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const randomId = (): string => {
  const random = randomBytes(16);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of random) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET.charAt((value << (5 - bits)) & 31);
  return out;
};

export const randomIds: IdGenerator = {
  task: () => TaskId(`t${randomId()}`),
  run: () => RunId(`r${randomId()}`),
};

const wrap = (base: pino.Logger): Logger => ({
  debug: (message, fields) => {
    base.debug(fields ?? {}, message);
  },
  info: (message, fields) => {
    base.info(fields ?? {}, message);
  },
  warn: (message, fields) => {
    base.warn(fields ?? {}, message);
  },
  error: (message, fields) => {
    base.error(fields ?? {}, message);
  },
  child: (fields: LogFields) => wrap(base.child(fields)),
});

/**
 * Structured JSON logs. Credentials never reach a log: values under these keys are replaced
 * wherever they appear.
 */
export const jsonLogger = (level: string, fields: LogFields = {}): Logger =>
  wrap(
    pino({
      level,
      base: fields,
      redact: {
        paths: [
          'authorization',
          '*.authorization',
          'credential',
          '*.credential',
          'token',
          '*.token',
          'headers["model-credential"]',
          'req.headers.authorization',
          'req.headers["model-credential"]',
        ],
        censor: '[redacted]',
      },
    }),
  );
