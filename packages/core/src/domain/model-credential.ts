import * as z from 'zod/mini';

/** Kinds of model credential a requester may bring: an API key, or a subscription token. */
export const MODEL_CREDENTIAL_KINDS = ['api-key', 'subscription'] as const;
export type ModelCredentialKind = (typeof MODEL_CREDENTIAL_KINDS)[number];

/**
 * The user's own model credential, for a receiver that runs tasks with it. Like the receiver's
 * token it belongs to one receiver, stays on this device and is never shown again once saved.
 */
export const modelCredentialSchema = z.object({
  kind: z.enum(MODEL_CREDENTIAL_KINDS),
  secret: z.string().check(z.trim(), z.minLength(1)),
});
export type ModelCredential = z.infer<typeof modelCredentialSchema>;
