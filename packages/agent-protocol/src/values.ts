import * as z from 'zod/mini';

/** The protocol's version: agent-host and the receiver refuse documents of any other. */
export const AGENT_PROTOCOL_VERSION = 1;

export const nonEmpty = z.string().check(z.minLength(1));
export const shaSchema = z.string().check(z.regex(/^[0-9a-f]{40}$/, 'Must be a git commit id'));
