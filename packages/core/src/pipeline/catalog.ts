import { appError, type AppError } from '../shared/errors';
import { err, ok, type Result } from '../shared/result';
import { parseWith } from '../shared/schema';
import type { ErasedFragmentDescriptor } from './descriptor';
import {
  fragmentEnvelopeSchema,
  stepCaptureEnvelopeSchema,
  type AnyFragment,
  type StepCapture,
} from './fragment';

export class CatalogConfigError extends Error {
  override readonly name = 'CatalogConfigError';
}

/**
 * The set of fragment kinds a context knows about. Parses untrusted fragments: checks the
 * envelope, migrates old data to the current version, and validates it with the module schema.
 */
export class FragmentCatalog {
  private readonly descriptors: ReadonlyMap<string, ErasedFragmentDescriptor>;

  constructor(descriptors: readonly ErasedFragmentDescriptor[]) {
    const byKind = new Map<string, ErasedFragmentDescriptor>();
    for (const descriptor of descriptors) {
      if (byKind.has(descriptor.kind)) {
        throw new CatalogConfigError(`Fragment kind "${descriptor.kind}" is registered twice`);
      }
      byKind.set(descriptor.kind, descriptor);
    }
    this.descriptors = byKind;
  }

  get(kind: string): ErasedFragmentDescriptor | undefined {
    return this.descriptors.get(kind);
  }

  parseFragment(raw: unknown): Result<AnyFragment, AppError> {
    const envelope = parseWith(fragmentEnvelopeSchema, raw);
    if (!envelope.ok) return envelope;
    const { kind, version } = envelope.value;
    const descriptor = this.descriptors.get(kind);
    if (descriptor === undefined) {
      return err(appError('validation', `Unknown fragment kind "${kind}"`));
    }
    if (version > descriptor.version) {
      return err(
        appError('validation', `Fragment "${kind}" v${String(version)} is newer than supported`, {
          supported: descriptor.version,
        }),
      );
    }

    let data = envelope.value.data;
    for (let from = version; from < descriptor.version; from += 1) {
      const migration = descriptor.migrations.find((m) => m.fromVersion === from);
      if (migration === undefined) {
        return err(appError('validation', `No migration for "${kind}" from v${String(from)}`));
      }
      data = migration.migrate(data);
    }

    const parsed = parseWith(descriptor.schema, data);
    if (!parsed.ok) return parsed;
    // Sound: data was validated with the schema registered for exactly this kind.
    return ok({
      ...envelope.value,
      version: descriptor.version,
      data: parsed.value,
    } as AnyFragment);
  }

  parseCapture(raw: unknown): Result<StepCapture, AppError> {
    const envelope = parseWith(stepCaptureEnvelopeSchema, raw);
    if (!envelope.ok) return envelope;
    const fragments: AnyFragment[] = [];
    for (const fragment of envelope.value.fragments) {
      const parsed = this.parseFragment(fragment);
      if (!parsed.ok) return parsed;
      fragments.push(parsed.value);
    }
    return ok({ fragments, diagnostics: envelope.value.diagnostics });
  }
}
