// Checks the Chrome Web Store upload against the store's rules for MV3 extensions, reading
// the zip itself (what reviewers get), not the build directory it was made from.
// Usage: node scripts/verify-store-package.mjs [path/to/redline-<version>-chrome.zip]
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

/**
 * @typedef {{
 *   manifest_version: number,
 *   version: string,
 *   name: string,
 *   description: string,
 *   default_locale: string,
 *   icons?: Record<string, string>,
 *   permissions?: string[],
 *   host_permissions?: string[],
 *   optional_host_permissions?: string[],
 *   content_scripts?: { js?: string[], css?: string[] }[],
 *   content_security_policy?: unknown,
 *   background?: { service_worker?: string },
 *   side_panel?: { default_path?: string },
 *   options_ui?: { page?: string },
 *   action?: { default_title?: string, default_popup?: string },
 *   commands?: Record<string, { description?: string }>,
 *   web_accessible_resources?: { resources?: string[] }[],
 * }} Manifest
 */

const OUTPUT = path.resolve(import.meta.dirname, '../apps/extension/.output');

const findZip = async () => {
  const zips = (await readdir(OUTPUT)).filter((name) => /^redline-.+-chrome\.zip$/.test(name));
  if (zips.length !== 1)
    throw new Error(`Expected one store zip in ${OUTPUT}, found ${zips.length}`);
  return path.join(OUTPUT, zips[0] ?? '');
};

const zipPath = process.argv[2] ?? (await findZip());
const files = unzipSync(new Uint8Array(await readFile(zipPath)));
/** @param {string} name */
const text = (name) => {
  const bytes = files[name];
  if (bytes === undefined) throw new Error(`${name} is missing from the package`);
  return strFromU8(bytes);
};
/** @type {string[]} */
const problems = [];
/** @param {boolean} condition @param {string} problem */
const check = (condition, problem) => {
  if (!condition) problems.push(problem);
};

/** Permissions the extension declares, each with the reason given in the store listing. */
const ALLOWED_PERMISSIONS = new Set([
  'sidePanel',
  'activeTab',
  'scripting',
  'contextMenus',
  'alarms',
  'storage',
  'notifications',
]);
const ALLOWED_OPTIONAL_HOSTS = new Set(['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
const ICON_SIZES = ['16', '32', '48', '128'];
const MAX_ZIP_BYTES = 2 * 1024 * 1024;

check(files['manifest.json'] !== undefined, 'manifest.json is missing at the zip root');
/** @type {Manifest} */
const manifest = JSON.parse(text('manifest.json'));

// Manifest basics.
check(manifest.manifest_version === 3, 'manifest_version must be 3');
check(
  /^\d{1,5}(\.\d{1,5}){0,3}$/.test(manifest.version) &&
    manifest.version.split('.').every((part) => Number(part) <= 65535),
  `version "${manifest.version}" is not 1–4 dot-separated integers up to 65535`,
);

// Localized texts: every __MSG_name__ resolves in every locale, within the store's limits.
const locales = Object.keys(files).flatMap((name) => {
  const locale = /^_locales\/([^/]+)\/messages\.json$/.exec(name)?.[1];
  return locale === undefined ? [] : [locale];
});
check(locales.includes(manifest.default_locale), 'default_locale has no messages.json');
/**
 * @param {string} locale
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
const messageOf = (locale, value) => {
  const key = /^__MSG_(\w+)__$/.exec(value ?? '')?.[1];
  if (key === undefined) return value;
  /** @type {Record<string, { message?: string }>} */
  const messages = JSON.parse(text(`_locales/${locale}/messages.json`));
  return messages[key]?.message;
};
/** @type {(readonly [field: string, value: string | undefined, limit: number])[]} */
const localized = [
  ['name', manifest.name, 75],
  ['description', manifest.description, 132],
  ['action.default_title', manifest.action?.default_title, Infinity],
  ...Object.entries(manifest.commands ?? {}).map(
    ([id, command]) =>
      /** @type {const} */ ([`commands.${id}.description`, command.description, Infinity]),
  ),
];
for (const locale of locales) {
  for (const [field, value, limit] of localized) {
    const resolved = messageOf(locale, value);
    check(typeof resolved === 'string' && resolved !== '', `${field} is empty in ${locale}`);
    check((resolved ?? '').length <= limit, `${field} is longer than ${limit} in ${locale}`);
  }
}

// Icons: declared at every size the store and browser use, and really that size.
/** @param {Uint8Array} bytes @returns {[number, number] | null} */
const pngSize = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const signature = view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a;
  return signature ? [view.getUint32(16), view.getUint32(20)] : null;
};
for (const size of ICON_SIZES) {
  const file = manifest.icons?.[size];
  check(file !== undefined, `icons.${size} is not declared`);
  if (file === undefined) continue;
  check(files[file] !== undefined, `icon ${file} is missing from the zip`);
  const icon = files[file];
  if (icon === undefined) continue;
  const dimensions = pngSize(icon);
  check(
    dimensions?.[0] === Number(size) && dimensions[1] === Number(size),
    `icon ${file} is not a ${size}×${size} PNG`,
  );
}

// Every file the manifest points to is in the package.
const referenced = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  manifest.options_ui?.page,
  manifest.action?.default_popup,
  ...(manifest.content_scripts ?? []).flatMap((script) => [
    ...(script.js ?? []),
    ...(script.css ?? []),
  ]),
].filter((file) => file !== undefined);
for (const file of referenced)
  check(files[file] !== undefined, `${file} is referenced but missing`);

// Pages the web may embed, and scripts the service worker injects by path (not in the
// manifest, so nothing else would notice a renamed or missing file before users do).
for (const entry of manifest.web_accessible_resources ?? []) {
  for (const file of entry.resources ?? []) {
    check(files[file] !== undefined, `web-accessible ${file} is missing`);
  }
}
const workerSource = text(manifest.background?.service_worker ?? 'background.js');
const injected = new Set(
  Array.from(
    workerSource.matchAll(/["'`]\/([\w./-]+\.(?:js|html))["'`]/g),
    (match) => match[1] ?? '',
  ),
);
check(injected.size > 0, 'the service worker names no script it injects: the check went blind');
for (const file of injected) {
  check(files[file] !== undefined, `${file} is injected by the service worker but missing`);
}

// Permissions: the declared set only, no host access at install time.
for (const permission of manifest.permissions ?? []) {
  check(
    ALLOWED_PERMISSIONS.has(permission),
    `permission "${permission}" has no store justification`,
  );
}
check(manifest.host_permissions === undefined, 'host_permissions must not be requested at install');
for (const host of manifest.optional_host_permissions ?? []) {
  check(ALLOWED_OPTIONAL_HOSTS.has(host), `optional host "${host}" has no store justification`);
}
check(manifest.content_scripts === undefined, 'no content scripts may run without a user gesture');

// No remote code (MV3): no relaxed CSP, no remote scripts, no string evaluation.
const csp = JSON.stringify(manifest.content_security_policy ?? {});
check(!/unsafe-eval|https?:/.test(csp), 'content_security_policy allows eval or remote sources');
for (const [name, bytes] of Object.entries(files)) {
  if (name.endsWith('.html')) {
    check(
      !/<script[^>]+src=["']?(https?:)?\/\//i.test(strFromU8(bytes)),
      `${name} loads a remote script`,
    );
  }
  if (name.endsWith('.js')) {
    const source = strFromU8(bytes);
    check(!/\beval\s*\(|\bFunction\s*\(/.test(source), `${name} evaluates strings as code`);
    check(
      !/\b(?:import|importScripts)\s*\(\s*["'`](?:https?:)?\/\//.test(source),
      `${name} loads remote code`,
    );
  }
  check(!name.endsWith('.map'), `${name}: source maps do not belong in the store package`);
  check(!/(^|\/)\.[^/]+$/.test(name), `${name}: hidden files do not belong in the store package`);
}

const zipBytes = (await readFile(zipPath)).length;
check(zipBytes <= MAX_ZIP_BYTES, `the package is ${zipBytes} bytes, over ${MAX_ZIP_BYTES}`);

if (problems.length > 0) {
  console.error(`${path.basename(zipPath)} would not pass store review:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `${path.basename(zipPath)}: ${Object.keys(files).length} files, ${(zipBytes / 1024).toFixed(0)} KB, ` +
      `locales ${locales.join(', ')} — ready for the Chrome Web Store.`,
  );
}
