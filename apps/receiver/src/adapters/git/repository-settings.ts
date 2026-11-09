import { parse as parseYaml } from 'yaml';
import * as z from 'zod/mini';
import { NO_SETTINGS, type RepositorySettings } from '../../ports/source';

/** Where a project's team tells the receiver how to work on its code, on the base commit. */
export const REPOSITORY_SETTINGS = '.redline/receiver.yaml';

const schema = z.object({
  /** Installs what the project needs, with the registries the project allows and nothing else. */
  setup: z.optional(
    z.object({
      run: z.string().check(z.minLength(1)),
      timeoutMinutes: z.optional(z.int().check(z.positive())),
    }),
  ),
  /** Commands that check a change, for the agent to run. */
  checks: z.optional(z.array(z.string().check(z.minLength(1)))),
});

/** Reads the project's settings; a file that is not valid is the project's error to fix. */
export const parseRepositorySettings = (
  text: string | null,
):
  | { readonly ok: true; readonly value: RepositorySettings }
  | { readonly ok: false; readonly detail: string } => {
  if (text === null) return { ok: true, value: NO_SETTINGS };
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (error) {
    return { ok: false, detail: `${REPOSITORY_SETTINGS} is not YAML: ${String(error)}` };
  }
  const parsed = schema.safeParse(document ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      detail: `${REPOSITORY_SETTINGS}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    };
  }
  return {
    ok: true,
    value: {
      setup:
        parsed.data.setup === undefined
          ? null
          : {
              run: parsed.data.setup.run,
              timeoutMs: (parsed.data.setup.timeoutMinutes ?? 0) * 60_000 || null,
            },
      checks: parsed.data.checks ?? [],
    },
  };
};
