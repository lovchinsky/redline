# Redline

A Chrome extension for asking a coding agent to change a website. Circle an area on any page,
say what should change, and Redline sends the request with compact context — screenshots,
anchors that find the code, layout, styles, components, errors — to a receiver that turns it
into a code change.

Redline knows nothing about repositories, branches or agents. It talks to one generic HTTP
API, the receiver, which maps projects to code and runs the agent. Target sites need no build
plugins, attributes or scripts.

## Using it

1. **Capture.** Press `Alt+Shift+A` (or choose “Circle an area (Redline)” in the context menu). Circle one
   or more areas, or click an element; `Tab` picks elements with the keyboard instead. Describe
   the change and press `Enter` (`Shift+Enter` for a new line). `Esc` cancels the step, a second
   `Esc` leaves capture.
2. **Draft.** Every step goes to the active draft, which can span several pages. The side panel
   (click the toolbar icon) lists its steps: rename the draft, edit, reorder or remove steps,
   switch drafts or start a new one. “Preview” shows exactly the files that will be sent.
3. **Send.** “Send to the agent” delivers the draft. The first time a site is sent, you pick its
   project; the site is remembered after that. Offline, the task waits in an outbox and is sent
   later, never twice.
4. **Follow.** The “In progress” tab shows where each task is, the agent’s questions (answer
   them in place) and a link to the result. The toolbar badge counts tasks in progress and
   turns orange when the agent asks something.

The receiver’s address and token, site bindings and capture diagnostics live on the
extension’s options page.

## Getting started

Requires Node.js 22+ and pnpm 10.

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts Chrome with the extension and hot reload. For a regular build:

```bash
pnpm build
```

then load `apps/extension/.output/chrome-mv3` via `chrome://extensions` → Developer mode →
Load unpacked.

To try it without a real receiver, start the mock receiver:

```bash
pnpm --filter @redline/mock-receiver start
```

and set `http://127.0.0.1:8787` as the receiver on the options page; it offers one project,
“Acme Web”.

## The receiver

The contract lives in `packages/contract` (`receiver-api.v1`, `bundle.v1`) and is all a
receiver needs to implement:

| Request                            | Purpose                                                     |
| ---------------------------------- | ----------------------------------------------------------- |
| `GET /v1/projects`                 | Projects a site can be bound to                             |
| `POST /v1/tasks`                   | Multipart: `manifest`, `projectId` and every bundle file    |
| `GET /v1/tasks/:remoteId`          | Status: queued, working, needs-input, result-ready, failed… |
| `POST /v1/tasks/:remoteId/replies` | The user’s answer to the agent’s question                   |

Requests carry `Authorization: Bearer <token>` when a token is set. `POST /v1/tasks` carries an
`Idempotency-Key`: a repeated key returns the task it already created. Every task response says
how soon the task may be asked again (`pollAfterSec`). A receiver that runs tasks with each
requester's own model credential says so in `GET /v1/projects` (`modelCredential`); the
credential then travels in the `Model-Credential` and `Model-Credential-Kind` headers.

`tools/contract-conformance` checks what the extension relies on; it runs against the mock
receiver and against the receiver in this repository.

## Running the receiver

`apps/receiver` is a receiver for one team: an HTTP API, a worker that runs the agent and
publishes changes, Postgres for state and its job queue. Its agent and git host are scripted for
now: the whole flow runs (a question, an answer, a change request) without a model or a
repository.

```bash
cd apps/receiver/deploy
cp receiver.example.yaml receiver.yaml   # projects, limits, whose model credentials
echo "REDLINE_DOMAIN=redline.example.com" >> .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
docker compose up -d
docker compose exec receiver node dist/receiver.mjs users add ann --name "Ann Lee"
docker compose exec receiver node dist/receiver.mjs users token ann
```

The token is shown once; with `https://redline.example.com` it goes on the extension's options
page. `receiver --help` lists the operator's commands: users and tokens, `config check`,
`tasks show` and `tasks cancel`.

A bundle is `manifest.json` plus `context.md` (the summary an agent reads first, within a token
budget per step), `more-context.md` (what did not fit), screenshots under `assets/` and detail
files under `details/`. Every file is listed in the manifest with its SHA-256.

## Privacy

Captured context stays on the device until the user sends it, and only to the receiver they
configured. Input values are never read, password and card fields are masked on screenshots,
and all collected text passes redaction of emails, card numbers, phone numbers, tokens and
secret URL parameters. There is no telemetry. See
[docs/store/privacy-policy.md](docs/store/privacy-policy.md).

## Repository

| Path                             | Role                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/core`                  | Domain (`Draft`, `Task`, delivery, bindings), pipeline primitives, `Result`; no browser |
| `packages/contract`              | Receiver contract: `receiver-api.v1`, `bundle.v1`                                       |
| `packages/rpc`                   | Typed RPC and events between extension contexts; the protocol, one module per feature   |
| `packages/geometry`              | Polygons, line simplification and smoothing, sampling                                   |
| `packages/dom`                   | Shadow-DOM-aware queries; `EnclosureResolver`: what exactly was circled                 |
| `packages/capture`               | Capture engine: collector contract, plan from a profile, isolation and timeouts         |
| `packages/modules`               | Context modules: descriptors (schema, presenter) and collectors (page only)             |
| `packages/processors`            | `redaction` of each step, `dedupe` of repeats across steps                              |
| `packages/profiles`              | What every step collects, and the token budget of a step                                |
| `packages/pipeline`              | Capture and assembly as the extension ships them; golden tests of `context.md`          |
| `packages/assembly`              | Bundle assembly: presenters → token budget → `context.md`, `more-context.md` → bundle   |
| `packages/page-runtime`          | Page-world script: React, Vue, Svelte and Angular components, errors, failed requests   |
| `apps/extension/src/ports`       | What use cases need from the platform                                                   |
| `apps/extension/src/adapters`    | The only place for `wxt/browser`, IndexedDB, storage, HTTP                              |
| `apps/extension/src/application` | Use cases; they depend on ports only                                                    |
| `apps/extension/src/composition` | Composition roots that assemble the system from adapters                                |
| `apps/extension/src/ui`          | Preact UI: overlay, side panel, options                                                 |
| `apps/extension/src/entrypoints` | WXT entry points; they only start a composition root                                    |
| `apps/receiver`                  | The receiver: domain, use cases, ports and adapters, like the extension                 |
| `tools/mock-receiver`            | In-memory receiver implementing `receiver-api.v1`, for e2e tests and trying things out  |
| `tools/contract-conformance`     | What the extension relies on in `receiver-api.v1`, run against any receiver             |
| `tools/eval`                     | Anchor quality on a corpus of real-world apps; gates CI                                 |

ESLint (`eslint-plugin-boundaries`) and dependency-cruiser enforce the boundaries between
layers and packages; their self-tests prove the rules fire on violations.

## Development

```bash
pnpm check             # format, lint, boundaries, dependency rules, types, unit tests
pnpm test:integration  # the receiver on a real Postgres
pnpm test:e2e          # build + Playwright with the extension loaded
pnpm eval       # anchor quality across the corpus
pnpm budgets    # size budgets of the scripts injected into pages
pnpm package    # Chrome Web Store zip, verified
```

`pnpm test:integration` and `pnpm test:e2e` need a Postgres server where they may create
databases: `REDLINE_TEST_DATABASE_URL=postgres://user@localhost:5432/postgres`. The e2e tests
start the real receiver against it, as well as the mock.

CI runs all of these. The store package is the exact build the e2e tests ran on.

## Rules

- A new dependency between layers starts as a rule in `eslint.config.js`, then the code.
- IndexedDB migrations are append-only (`apps/extension/src/adapters/idb/schema.ts`).
- A new kind of context is a new folder in `packages/modules/src` (types, descriptor, collector)
  plus a line in `descriptors.ts`, `collectors.ts` and the profile. Golden tests show how
  `context.md` changes.
- A new RPC method goes into its feature’s module in `packages/rpc/src/protocol/`; the type
  system requires its handler.
- Documentation, specifications and comments describe the system as it is: no “previously /
  used to be / changed from”, no migration narratives, no changelog in prose. Rationale is a
  present-tense property of the design. History lives in git.

## License

[MIT](LICENSE)
