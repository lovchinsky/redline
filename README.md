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

Requires Node.js 22.22.3 or later and pnpm 10.

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

## Run it on your machine

The receiver runs on your own machine with Docker and a GitHub token, nothing more:

```bash
cd apps/receiver/deploy
export GITHUB_TOKEN=github_pat_…
docker compose -f compose.local.yaml up
```

The token is a [fine-grained personal access token](https://github.com/settings/personal-access-tokens)
for the repositories Redline may change, with `Contents` and `Pull requests` read and write (and
nothing for `Workflows`): those repositories are the projects. The first start builds the
receiver's and the sandbox's images, which takes a few minutes; then `setup` prints the
receiver's address and a token. Set both on the extension's options page, with your own
Anthropic key or Claude subscription token: the key travels with the extension's requests and
stays in the gateway's memory, never on disk. `docker compose -f compose.local.yaml logs setup`
shows the address and the token again.

A task's change arrives as a draft pull request from a branch `redline/<task>` of the
repository, in a commit that is yours: by the token's owner, with Redline as its co-author; that branch runs the repository's CI with the agent's code, so a repository whose CI
has secrets is better published through a bot's fork (`git.fork.owner`, `target: fork`).
Sandboxes run under gVisor where Docker has it, and under runc, isolated by containers alone,
where it has not; the worker's log says which. The API listens on `127.0.0.1` only. For more
than the defaults (budgets, a project's rules, hidden repositories), mount a `receiver.yaml` in
place of the configuration inline in `compose.local.yaml`. `docker compose -f compose.local.yaml
down` stops it; tasks and mirrors stay in its volumes until `down -v`.

## Running the receiver on a server

`apps/receiver` is a receiver for one team. Its services run with only what each needs:

- `api` serves the extension (tasks, users, tokens) and has no Docker, git host or model key;
- `worker` runs tasks: a Docker sandbox per run (gVisor), and mirrors of the projects'
  repositories, a cache it fills again from the git host whenever a commit is missing;
- `gateway` is the agent sandboxes' only way out, to the model: it filters every request, puts
  the task's model credential in place of the run's grant, and holds a task to its budget: each
  request reserves the most it can cost before it goes, and settles with what it used;
- `egress` tunnels the setup sandboxes to their projects' package registries, and nowhere else;
- Postgres keeps the state and the job queue; Caddy terminates TLS in front of the API.

A run is two sandboxes on the run's own volumes: the project's install and `agent-host`
(`apps/agent-host`), which runs Claude Code through the Agent SDK and leaves its outcome and
change for the worker. The team says how to install and check its code in
`.redline/receiver.yaml` on the base commit; a file that is not valid fails the task's setup. A question
to the requester pauses the run: the worker keeps the session and the work so far, and after the
answer the next run goes on with them in new sandboxes. A session resumes only on the image and
model that wrote it; after either changes, the run starts over, told the questions and answers.

```bash
docker build -f apps/agent-host/Dockerfile -t redline-agent .   # the sandbox image
cd apps/receiver/deploy
cp receiver.example.yaml receiver.yaml   # projects, limits, whose model credentials
mkdir -p secrets && printf %s "$ANTHROPIC_API_KEY" > secrets/anthropic-api-key
echo "REDLINE_DOMAIN=redline.example.com" >> .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
echo "DOCKER_GID=$(stat -c %g /var/run/docker.sock)" >> .env
echo "REDLINE_GIT_ROOT=/srv/git" >> .env   # the repositories of `git: local`
docker compose up -d
docker compose exec api node dist/receiver.mjs users add ann --name "Ann Lee" --email ann@acme.io
docker compose exec api node dist/receiver.mjs users token ann
```

The host needs gVisor (`runsc` registered with Docker): the worker refuses to start a sandbox
without it, unless the configuration waives isolation by name (`isolation: unsafe-runc`); it says
so as it starts, and runs that cannot start are tried again as the infrastructure's failures. The
token is shown once; with `https://redline.example.com` it goes on the extension's options page.
A task's commit is its requester's: they are its author by the email they were added with (the one
their GitHub account has, so that GitHub and deployment checks know them), and the receiver
(`git.commitAs`) its co-author; a requester without an email is named in the commit instead.
`receiver --help` lists the operator's commands: users and tokens, `config check`, `tasks show`
and `tasks cancel`. Compose runs `receiver migrate` before the other services start: it alone, and
the worker, bring the database schema and the queues up to date. `agent: { kind: scripted }` runs the whole flow (a question, an answer, a
change request) without a model or sandboxes. With `git: github` the worker publishes pull requests through a
GitHub App or a bot's token, to a branch of the repository (or the bot's fork), after gitleaks found no
secret in the change; the projects are then the repositories the App's installations or the token
reach, which the worker lists as it starts and every ten minutes, and `receiver config check` also checks each of
them and its publishing target, the sandboxes and their image.

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
| `apps/agent-host`                | The program in a run's sandbox: one brief, Claude Code, an outcome, a change or a pause |
| `packages/agent-protocol`        | What the receiver and agent-host exchange: the run's files, brief, outcome, pause       |
| `packages/path-patterns`         | Path globs read the same way by the change policy and the agent's write guard           |
| `tools/mock-receiver`            | In-memory receiver implementing `receiver-api.v1`, for e2e tests and trying things out  |
| `tools/contract-conformance`     | What the extension relies on in `receiver-api.v1`, run against any receiver             |
| `tools/eval`                     | Anchor quality on a corpus of real-world apps; gates CI                                 |

ESLint (`eslint-plugin-boundaries`) and dependency-cruiser enforce the boundaries between
layers and packages; their self-tests prove the rules fire on violations.

## Development

```bash
pnpm check             # format, lint, boundaries, dependency rules, types, unit tests
pnpm test:integration  # the receiver on a real Postgres and a real Docker Engine
pnpm test:e2e          # build + Playwright with the extension loaded
pnpm eval       # anchor quality across the corpus
pnpm budgets    # size budgets of the scripts injected into pages
pnpm package    # Chrome Web Store zip, verified
```

`pnpm test:integration` and `pnpm test:e2e` need a Postgres server where they may create
databases: `REDLINE_TEST_DATABASE_URL=postgres://user@localhost:5432/postgres`. The e2e tests
start the real receiver against it, as well as the mock. `pnpm test:integration` also runs
agent sandboxes: `REDLINE_TEST_DOCKER=/var/run/docker.sock` names the Docker Engine. Its test
image is made from this machine's own `sh` and `node`; nothing is pulled. The secret scanner's
test runs gitleaks: `REDLINE_TEST_GITLEAKS=/usr/local/bin/gitleaks`.

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
