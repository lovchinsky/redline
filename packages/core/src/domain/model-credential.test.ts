import { describe, expect, it } from 'vitest';
import { modelCredentialSchema } from './model-credential';

describe('modelCredentialSchema', () => {
  it('takes a pasted key without the spaces around it', () => {
    expect(modelCredentialSchema.parse({ kind: 'api-key', secret: ' sk-ant-api-1\n' })).toEqual({
      kind: 'api-key',
      secret: 'sk-ant-api-1',
    });
  });

  it('refuses a blank key and an unknown kind', () => {
    expect(modelCredentialSchema.safeParse({ kind: 'api-key', secret: '   ' }).success).toBe(false);
    expect(modelCredentialSchema.safeParse({ kind: 'password', secret: 'x' }).success).toBe(false);
  });
});
