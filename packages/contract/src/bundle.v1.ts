import * as z from 'zod/mini';

export const BUNDLE_SCHEMA_VERSION = 1;
export const BUNDLE_ENTRY = 'context.md';

export const intentSchema = z.enum(['text', 'style', 'layout', 'bug', 'new-element']);
export type Intent = z.infer<typeof intentSchema>;

/** Relative POSIX path inside the bundle: no leading slash, no `..` segments. */
export const bundlePathSchema = z
  .string()
  .check(
    z.minLength(1),
    z.regex(
      /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w.\-/]+$/,
      'Must be a relative path inside the bundle',
    ),
  );

export const bundleFileSchema = z.object({
  path: bundlePathSchema,
  mediaType: z.string().check(z.minLength(1)),
  sha256: z.string().check(z.regex(/^[a-f0-9]{64}$/, 'Must be a lowercase hex SHA-256')),
  bytes: z.int().check(z.nonnegative()),
});

export const viewportSchema = z.object({
  width: z.int().check(z.positive()),
  height: z.int().check(z.positive()),
  devicePixelRatio: z.number().check(z.positive()),
  scrollX: z.number(),
  scrollY: z.number(),
});

export const bundleShapeSchema = z.object({
  id: z.string().check(z.minLength(1)),
  files: z.array(bundlePathSchema),
});

export const bundleStepSchema = z.object({
  id: z.string().check(z.minLength(1)),
  url: z.url(),
  routePattern: z.string(),
  intent: intentSchema,
  comment: z.string(),
  viewport: viewportSchema,
  shapes: z.array(bundleShapeSchema).check(z.minLength(1)),
});

const manifestShape = z.object({
  schemaVersion: z.literal(BUNDLE_SCHEMA_VERSION),
  taskId: z.string().check(z.minLength(1)),
  projectId: z.string().check(z.minLength(1)),
  createdAt: z.iso.datetime(),
  client: z.object({ version: z.string().check(z.minLength(1)) }),
  steps: z.array(bundleStepSchema).check(z.minLength(1)),
  files: z.array(bundleFileSchema),
  entry: z.literal(BUNDLE_ENTRY),
});

type ManifestShape = z.infer<typeof manifestShape>;

const referencedPaths = (m: ManifestShape): string[] => [
  m.entry,
  ...m.steps.flatMap((step) => step.shapes.flatMap((shape) => shape.files)),
];

const hasUniquePaths = (m: ManifestShape): boolean =>
  new Set(m.files.map((f) => f.path)).size === m.files.length;

const referencesResolve = (m: ManifestShape): boolean => {
  const listed = new Set(m.files.map((f) => f.path));
  return referencedPaths(m).every((path) => listed.has(path));
};

/** `manifest.json` of a bundle. Every referenced path must be listed exactly once in `files`. */
export const bundleManifestSchema = manifestShape.check(
  z.refine(hasUniquePaths, 'File paths must be unique'),
  z.refine(referencesResolve, 'Every referenced path must be listed in files'),
);

export type BundleManifest = z.infer<typeof bundleManifestSchema>;
export type BundleFile = z.infer<typeof bundleFileSchema>;
export type BundleStep = z.infer<typeof bundleStepSchema>;
export type Viewport = z.infer<typeof viewportSchema>;
