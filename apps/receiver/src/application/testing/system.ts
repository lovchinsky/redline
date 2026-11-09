import type { ModelAccessPolicy, ModelCredential, User } from '../../ports/access';
import { CredentialRelay } from '../credentials';
import { TaskOperations } from '../operations';
import { PublishChange } from '../publish-change';
import { TaskRequests } from '../requests';
import { SuperviseRun } from '../supervise-run';
import { AbortRun, ExpireQuestion, WithdrawChange } from '../task-jobs';
import { TaskWriter } from '../task-writer';
import {
  FakeBundles,
  FakeCatalog,
  FakeGit,
  FakeIdentity,
  FakeRunner,
  FixedClock,
  MANIFEST,
  MemoryStore,
  MemoryVault,
  SequentialIds,
  ann,
  managed,
  silentLogger,
} from './fakes';

/** The application wired to fakes, as a composition root wires it to adapters. */
export const system = (access: ModelAccessPolicy = managed) => {
  const store = new MemoryStore();
  const clock = new FixedClock();
  const ids = new SequentialIds();
  const catalog = new FakeCatalog();
  const bundles = new FakeBundles();
  const vault = new MemoryVault();
  const runner = new FakeRunner();
  const git = new FakeGit();
  const identity = new FakeIdentity();
  const writer = new TaskWriter({ uow: store, clock });
  const relay = new CredentialRelay({ vault, writer, policy: access, logger: silentLogger });
  const requests = new TaskRequests({
    queries: store,
    writer,
    projects: catalog,
    bundles,
    vault,
    relay,
    access,
    ids,
    clock,
  });
  const supervise = new SuperviseRun({
    queries: store,
    uow: store,
    writer,
    projects: catalog,
    bundles,
    source: git,
    runner,
    vault,
    ids,
    clock,
    logger: silentLogger,
  });
  const publish = new PublishChange({
    queries: store,
    writer,
    projects: catalog,
    bundles,
    identity,
    source: git,
    scanner: git,
    forge: git,
    logger: silentLogger,
  });
  const expire = new ExpireQuestion({ writer, projects: catalog });
  const abort = new AbortRun({ runner });
  const withdraw = new WithdrawChange({
    queries: store,
    projects: catalog,
    forge: git,
    logger: silentLogger,
  });
  const operations = new TaskOperations({ queries: store, writer });

  const submit = async (
    options: { user?: User; key?: string; credential?: ModelCredential | null } = {},
  ) => {
    const submitted = await requests.submit({
      requester: options.user ?? ann,
      idempotencyKey: options.key ?? 'delivery-1',
      projectId:
        catalog.projects[0]?.id ??
        (() => {
          throw new Error('No project');
        })(),
      manifest: MANIFEST,
      credential: options.credential ?? null,
    });
    if (!submitted.ok) throw new Error(submitted.error.message);
    return submitted.value;
  };

  return {
    store,
    clock,
    catalog,
    bundles,
    vault,
    runner,
    git,
    writer,
    requests,
    supervise,
    publish,
    expire,
    abort,
    withdraw,
    operations,
    submit,
  };
};

export const never = new AbortController().signal;
