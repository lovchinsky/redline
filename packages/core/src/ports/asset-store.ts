import * as z from 'zod/mini';
import type { AppError } from '../shared/errors';
import { idSchema } from '../shared/ids';
import type { Result } from '../shared/result';

export const AssetId = idSchema().brand<'AssetId'>();
export type AssetId = z.infer<typeof AssetId>;

export const assetRefSchema = z.object({
  id: AssetId,
  mediaType: z.string(),
  bytes: z.number(),
});

/** Lightweight handle to a binary asset. Assets themselves never cross messaging. */
export type AssetRef = z.infer<typeof assetRefSchema>;

export interface AssetStore {
  put(data: Blob): Promise<Result<AssetRef, AppError>>;
  get(id: AssetId): Promise<Result<Blob, AppError>>;
  release(id: AssetId): Promise<Result<void, AppError>>;
}
