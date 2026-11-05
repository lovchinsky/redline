import * as z from 'zod/mini';

/** What kind of change a step asks for. Drives which context gets collected. */
export const INTENTS = ['text', 'style', 'layout', 'bug', 'new-element'] as const;

export const intentSchema = z.enum(INTENTS);
export type Intent = z.infer<typeof intentSchema>;
