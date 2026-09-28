import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const databaseUrl = process.env.TUCK_TEST_DATABASE_URL;
const USER_A = '10000000-0000-4000-8000-000000000001';
const USER_B = '10000000-0000-4000-8000-000000000002';
const ZERO_INSTANCE = '00000000-0000-0000-0000-000000000000';

function blocked(message) {
  console.error(`BLOCKED: ${message}`);
  process.exit(2);
}

if (!databaseUrl) blocked('TUCK_TEST_DATABASE_URL is not set. Point it at an isolated migrated Supabase/PostgreSQL test database.');
if (spawnSync('psql', ['--version'], { stdio: 'ignore' }).status !== 0) blocked('psql is not installed or not on PATH.');

function psqlArgs(sql) {
  return [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q', '-c', sql];
}

function run(sql) {
  const result = spawnSync('psql', psqlArgs(sql), { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`psql failed (${result.status}):\n${result.stderr}\nSQL:\n${sql}`);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '';
}

function spawnSql(sql) {
  const child = spawn('psql', psqlArgs(sql), { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  return {
    child,
    done: new Promise((resolve, reject) => child.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`psql failed (${code}):\n${stderr}\nSQL:\n${sql}`));
    })),
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function assert(condition, message) { if (!condition) throw new Error(`ASSERTION FAILED: ${message}`); }
function q(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function createItemMutation(accountId, mutationId, itemId, title = 'Item') {
  return {
    protocolVersion: 1,
    accountId,
    mutationId,
    originDeviceId: 'phase6b-live-test',
    entityType: 'item',
    entityId: itemId,
    action: 'create',
    baseServerVersion: null,
    changedFields: ['title','body','url','assetId','tags','collectionId','pinned','archived','updatedAt'],
    baseValues: {},
    newValues: {
      type: 'note', title, body: 'body', url: null, assetId: null, tags: [], collectionId: null,
      pinned: false, archived: false, createdAt: 1000, updatedAt: 1000,
    },
  };
}

function createCollectionMutation(accountId, mutationId, collectionId, name = 'Collection') {
  return {
    protocolVersion: 1, accountId, mutationId, originDeviceId: 'phase6b-live-test',
    entityType: 'collection', entityId: collectionId, action: 'create', baseServerVersion: null,
    changedFields: ['name','updatedAt'], baseValues: {}, newValues: { name, createdAt: 1000, updatedAt: 1000 },
  };
}

function patchItemMutation(accountId, mutationId, itemId, baseServerVersion, changedFields, baseValues, newValues) {
  return {
    protocolVersion: 1, accountId, mutationId, originDeviceId: 'phase6b-live-test',
    entityType: 'item', entityId: itemId, action: 'patch', baseServerVersion,
    changedFields, baseValues, newValues,
  };
}

function deleteCollectionMutation(accountId, mutationId, collectionId, baseServerVersion) {
  return {
    protocolVersion: 1, accountId, mutationId, originDeviceId: 'phase6b-live-test',
    entityType: 'collection', entityId: collectionId, action: 'delete', baseServerVersion,
    changedFields: [], baseValues: {}, newValues: {},
  };
}

function privateMutationSql(userId, mutation, tail = 'COMMIT') {
  return `BEGIN; SELECT private.process_mutation_v1(${q(userId)}::uuid, ${q(JSON.stringify(mutation))}::jsonb); ${tail};`;
}

function rpcSql(userId, functionName, request) {
  return `BEGIN; SELECT set_config('request.jwt.claim.sub', ${q(userId)}, true); SET LOCAL ROLE authenticated; SELECT public.${functionName}(${q(JSON.stringify(request))}::jsonb); COMMIT;`;
}

function resetUsers() {
  run(`
    DELETE FROM auth.users WHERE id IN (${q(USER_A)}::uuid, ${q(USER_B)}::uuid);
    INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
    VALUES
      (${q(ZERO_INSTANCE)}::uuid,${q(USER_A)}::uuid,'authenticated','authenticated','phase6b-a@example.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now(),'','','',''),
      (${q(ZERO_INSTANCE)}::uuid,${q(USER_B)}::uuid,'authenticated','authenticated','phase6b-b@example.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now(),'','','','');
  `);
  assert(run(`SELECT count(*) FROM public.accounts WHERE user_id IN (${q(USER_A)}::uuid,${q(USER_B)}::uuid);`) === '2', 'auth trigger must initialize exactly two Tuck accounts');
}

async function sameAccountCommitSerializes() {
  resetUsers();
  const m1 = createItemMutation(USER_A, '20000000-0000-4000-8000-000000000001', 'same-a-1');
  const m2 = createItemMutation(USER_A, '20000000-0000-4000-8000-000000000002', 'same-a-2');
  const t1 = spawnSql(privateMutationSql(USER_A, m1, 'SELECT pg_sleep(2); COMMIT'));
  await sleep(250);
  const started = performance.now();
  run(privateMutationSql(USER_A, m2));
  const elapsed = performance.now() - started;
  await t1.done;
  assert(elapsed >= 1200, `same-account T2 was not serialized by the head row (${elapsed.toFixed(0)}ms)`);
  assert(run(`SELECT head_seq FROM private.account_sync_heads WHERE user_id=${q(USER_A)}::uuid`) === '2', 'commit case head must be 2');
  assert(run(`SELECT string_agg(seq::text,',' ORDER BY seq) FROM private.sync_changes WHERE user_id=${q(USER_A)}::uuid`) === '1,2', 'commit case must expose seq 1,2 only');
}

async function sameAccountRollbackReusesUncommittedSequence() {
  resetUsers();
  const m1 = createItemMutation(USER_A, '20000000-0000-4000-8000-000000000003', 'rollback-a-1');
  const m2 = createItemMutation(USER_A, '20000000-0000-4000-8000-000000000004', 'rollback-a-2');
  const t1 = spawnSql(privateMutationSql(USER_A, m1, 'SELECT pg_sleep(2); ROLLBACK'));
  await sleep(250);
  const started = performance.now();
  run(privateMutationSql(USER_A, m2));
  const elapsed = performance.now() - started;
  await t1.done;
  assert(elapsed >= 1200, 'same-account writer did not wait for rollback');
  assert(run(`SELECT head_seq FROM private.account_sync_heads WHERE user_id=${q(USER_A)}::uuid`) === '1', 'rolled-back head allocation must not survive');
  assert(run(`SELECT count(*) FROM private.processed_mutations WHERE user_id=${q(USER_A)}::uuid`) === '1', 'rolled-back processed result must not survive');
  assert(run(`SELECT min(seq)||':'||max(seq) FROM private.sync_changes WHERE user_id=${q(USER_A)}::uuid`) === '1:1', 'post-rollback committed sequence must be 1');
}

async function differentAccountsDoNotSerialize() {
  resetUsers();
  const m1 = createItemMutation(USER_A, '20000000-0000-4000-8000-000000000005', 'account-a');
  const m2 = createItemMutation(USER_B, '20000000-0000-4000-8000-000000000006', 'account-b');
  const t1 = spawnSql(privateMutationSql(USER_A, m1, 'SELECT pg_sleep(2); COMMIT'));
  await sleep(250);
  const started = performance.now();
  run(privateMutationSql(USER_B, m2));
  const elapsed = performance.now() - started;
  await t1.done;
  assert(elapsed < 1200, `different-account writer serialized unexpectedly (${elapsed.toFixed(0)}ms)`);
  assert(run(`SELECT head_seq FROM private.account_sync_heads WHERE user_id=${q(USER_B)}::uuid`) === '1', 'account B must have independent head 1');
}

function idempotencyAndWrongAccount() {
  resetUsers();
  const id = '20000000-0000-4000-8000-000000000007';
  const m = createItemMutation(USER_A, id, 'idem-item', 'original');
  const request = { protocolVersion: 1, accountId: USER_A, mutations: [m] };
  const first = JSON.parse(run(rpcSql(USER_A, 'tuck_push_mutations', request)));
  const replay = JSON.parse(run(rpcSql(USER_A, 'tuck_push_mutations', request)));
  assert(first.results[0].changeSequence === replay.results[0].changeSequence, 'same ID/same payload must replay the original result');
  assert(replay.headSequence === 1, 'same ID/same payload must not increment the head');

  const changed = createItemMutation(USER_A, id, 'idem-item', 'different');
  const reuse = JSON.parse(run(rpcSql(USER_A, 'tuck_push_mutations', { ...request, mutations: [changed] })));
  assert(reuse.results[0].code === 'MUTATION_ID_REUSE', 'same ID/different payload must be rejected');
  assert(reuse.headSequence === 1, 'mutation ID reuse must not increment head');

  const wrong = JSON.parse(run(rpcSql(USER_A, 'tuck_pull_changes', { protocolVersion: 1, accountId: USER_B, afterSequence: 0, limit: 10 })));
  assert(wrong.code === 'WRONG_ACCOUNT', 'RPC caller cannot act as a different account');
}

async function bootstrapRaceAndCatchup() {
  resetUsers();
  const m = createItemMutation(USER_A, '20000000-0000-4000-8000-000000000008', 'race-item');
  const writer = spawnSql(privateMutationSql(USER_A, m, 'SELECT pg_sleep(2); COMMIT'));
  await sleep(250);
  const bootstrapReq = { protocolVersion: 1, accountId: USER_A, pageSize: 50 };
  const beforeCommit = JSON.parse(run(rpcSql(USER_A, 'tuck_bootstrap', bootstrapReq)));
  assert(beforeCommit.snapshotHeadSequence === 0, 'bootstrap during uncommitted writer must see old head');
  assert(beforeCommit.entries.length === 0, 'bootstrap during uncommitted writer must see old entity state');
  await writer.done;
  const pull = JSON.parse(run(rpcSql(USER_A, 'tuck_pull_changes', { protocolVersion: 1, accountId: USER_A, afterSequence: beforeCommit.snapshotHeadSequence, limit: 50 })));
  assert(pull.kind === 'page' && pull.changes.length === 1 && pull.changes[0].entityId === 'race-item', 'catch-up pull must retrieve writer committed after bootstrap snapshot');

  resetUsers();
  run(privateMutationSql(USER_A, createItemMutation(USER_A, '20000000-0000-4000-8000-000000000009', 'prebootstrap-item')));
  const afterCommit = JSON.parse(run(rpcSql(USER_A, 'tuck_bootstrap', bootstrapReq)));
  assert(afterCommit.snapshotHeadSequence === 1, 'bootstrap after committed writer must see new head');
  assert(afterCommit.entries.some(entry => entry.snapshot.entityType === 'item' && entry.snapshot.entity.id === 'prebootstrap-item'), 'bootstrap after committed writer must see new entity state');
}

function mergeVersioningAndCollectionDelete() {
  resetUsers();
  const itemId = 'merge-item';
  run(privateMutationSql(USER_A, createItemMutation(USER_A, '20000000-0000-4000-8000-000000000020', itemId, 'Title A')));
  const bodyPatch = patchItemMutation(
    USER_A, '20000000-0000-4000-8000-000000000021', itemId, 1,
    ['body','updatedAt'], { body: 'body' }, { body: 'body-remote', updatedAt: 2000 },
  );
  const bodyResult = JSON.parse(run(privateMutationSql(USER_A, bodyPatch)));
  assert(bodyResult.kind === 'accepted' && bodyResult.serverVersion === 2, 'first patch must advance server version to 2');

  const disjoint = patchItemMutation(
    USER_A, '20000000-0000-4000-8000-000000000022', itemId, 1,
    ['title','updatedAt'], { title: 'Title A' }, { title: 'Title local', updatedAt: 3000 },
  );
  const disjointResult = JSON.parse(run(privateMutationSql(USER_A, disjoint)));
  assert(disjointResult.kind === 'accepted' && disjointResult.serverVersion === 3, 'stale-base disjoint authored field must merge and advance to v3');

  const conflict = patchItemMutation(
    USER_A, '20000000-0000-4000-8000-000000000023', itemId, 1,
    ['title','updatedAt'], { title: 'Title A' }, { title: 'Other title', updatedAt: 4000 },
  );
  const conflictResult = JSON.parse(run(privateMutationSql(USER_A, conflict)));
  assert(conflictResult.kind === 'conflict' && conflictResult.reason === 'AUTHORED_FIELD_CONFLICT', 'same authored field divergence must conflict');
  assert(run(`SELECT head_seq FROM private.account_sync_heads WHERE user_id=${q(USER_A)}::uuid`) === '3', 'conflict must not allocate a change sequence');

  const collectionId = 'delete-me';
  run(privateMutationSql(USER_A, createCollectionMutation(USER_A, '20000000-0000-4000-8000-000000000024', collectionId, 'Delete Me')));
  const fileIntoCollection = patchItemMutation(
    USER_A, '20000000-0000-4000-8000-000000000029', itemId, 3,
    ['collectionId'], { collectionId: null }, { collectionId },
  );
  const filed = JSON.parse(run(privateMutationSql(USER_A, fileIntoCollection)));
  assert(filed.kind === 'accepted', 'fixture Item must be filed through the protocol before Collection delete');
  const before = run(`SELECT updated_at||':'||version FROM public.items WHERE user_id=${q(USER_A)}::uuid AND id=${q(itemId)}`);
  const del = deleteCollectionMutation(USER_A, '20000000-0000-4000-8000-000000000025', collectionId, 1);
  run(privateMutationSql(USER_A, del, 'ROLLBACK'));
  assert(run(`SELECT count(*) FROM public.collections WHERE user_id=${q(USER_A)}::uuid AND id=${q(collectionId)}`) === '1', 'rolled-back collection delete must preserve collection');
  assert(run(`SELECT collection_id FROM public.items WHERE user_id=${q(USER_A)}::uuid AND id=${q(itemId)}`) === collectionId, 'rolled-back collection delete must preserve filing');
  assert(run(`SELECT count(*) FROM private.entity_tombstones WHERE user_id=${q(USER_A)}::uuid AND entity_type='collection' AND entity_id=${q(collectionId)}`) === '0', 'rolled-back delete must leave no tombstone');

  const committed = JSON.parse(run(privateMutationSql(USER_A, del)));
  assert(committed.kind === 'accepted' && committed.changed === true, 'collection delete must commit atomically');
  assert(run(`SELECT collection_id IS NULL FROM public.items WHERE user_id=${q(USER_A)}::uuid AND id=${q(itemId)}`) === 't', 'collection delete must unfile affected item');
  const after = run(`SELECT updated_at||':'||version FROM public.items WHERE user_id=${q(USER_A)}::uuid AND id=${q(itemId)}`);
  assert(before.split(':')[0] === after.split(':')[0], 'collection delete must preserve Item updatedAt');
  assert(Number(after.split(':')[1]) === Number(before.split(':')[1]) + 1, 'collection delete must increment affected Item server version');
  assert(run(`SELECT count(*) FROM private.entity_tombstones WHERE user_id=${q(USER_A)}::uuid AND entity_type='collection' AND entity_id=${q(collectionId)}`) === '1', 'collection delete must create lifetime tombstone');

  const staleRecreate = JSON.parse(run(privateMutationSql(USER_A, createCollectionMutation(USER_A, '20000000-0000-4000-8000-000000000026', collectionId, 'Recreate'))));
  assert(staleRecreate.code === 'ENTITY_ID_REUSED_AFTER_DELETE', 'collection tombstone must prevent stale resurrection/reuse');
}

function sharedReadyAssetReferences() {
  resetUsers();
  run(`INSERT INTO public.assets(user_id,id,storage_path,mime_type,byte_size,state,version,ready_at)
       VALUES(${q(USER_A)}::uuid,'asset-shared',${q(`${USER_A}/asset-shared/original.jpg`)},'image/jpeg',123,'ready',2,now());`);
  const makeImage = (mid, id) => ({
    protocolVersion: 1, accountId: USER_A, mutationId: mid, originDeviceId: 'phase6b-live-test',
    entityType: 'item', entityId: id, action: 'create', baseServerVersion: null,
    changedFields: ['title','body','url','assetId','tags','collectionId','pinned','archived','updatedAt'], baseValues: {},
    newValues: { type: 'image', title: id, body: null, url: null, assetId: 'asset-shared', tags: [], collectionId: null, pinned: false, archived: false, createdAt: 1000, updatedAt: 1000 },
  });
  const a = JSON.parse(run(privateMutationSql(USER_A, makeImage('20000000-0000-4000-8000-000000000027','img-a'))));
  const b = JSON.parse(run(privateMutationSql(USER_A, makeImage('20000000-0000-4000-8000-000000000028','img-b'))));
  assert(a.kind === 'accepted' && b.kind === 'accepted', 'one ready Asset must be reusable by multiple Items');
  assert(run(`SELECT count(*) FROM public.items WHERE user_id=${q(USER_A)}::uuid AND asset_id='asset-shared'`) === '2', 'shared Asset must have two live Item references without duplication');
}

function pullRetentionAndPagination() {
  resetUsers();
  for (let i = 0; i < 3; i += 1) {
    const suffix = String(10 + i).padStart(12, '0');
    run(privateMutationSql(USER_A, createItemMutation(USER_A, `20000000-0000-4000-8000-${suffix}`, `page-${i}`)));
  }
  const first = JSON.parse(run(rpcSql(USER_A, 'tuck_pull_changes', { protocolVersion: 1, accountId: USER_A, afterSequence: 0, limit: 1 })));
  assert(first.targetHeadSequence === 3 && first.changes.length === 1 && first.hasMore === true, 'first pull page must capture finite head 3');
  const second = JSON.parse(run(rpcSql(USER_A, 'tuck_pull_changes', { protocolVersion: 1, accountId: USER_A, afterSequence: first.nextAfterSequence, limit: 10, targetHeadSequence: first.targetHeadSequence })));
  assert(second.changes.length === 2 && second.nextAfterSequence === 3 && second.hasMore === false, 'continued pull must finish captured target');
  run(`UPDATE public.accounts SET change_retention_floor_seq=3 WHERE user_id=${q(USER_A)}::uuid;`);
  const stale = JSON.parse(run(rpcSql(USER_A, 'tuck_pull_changes', { protocolVersion: 1, accountId: USER_A, afterSequence: 0, limit: 10 })));
  assert(stale.kind === 'rebootstrap_required' && stale.minimumRetainedSequence === 3, 'stale cursor must require rebootstrap');
}

try {
  await sameAccountCommitSerializes();
  console.log('PASS same-account sequencing: commit');
  await sameAccountRollbackReusesUncommittedSequence();
  console.log('PASS same-account sequencing: rollback');
  await differentAccountsDoNotSerialize();
  console.log('PASS account-scoped concurrency');
  idempotencyAndWrongAccount();
  console.log('PASS idempotency + wrong-account RPC security');
  await bootstrapRaceAndCatchup();
  console.log('PASS bootstrap MVCC race + catch-up');
  mergeVersioningAndCollectionDelete();
  console.log('PASS merge/versioning + atomic Collection delete/rollback + tombstone');
  sharedReadyAssetReferences();
  console.log('PASS ready Asset reuse across multiple Items');
  pullRetentionAndPagination();
  console.log('PASS pull finite target + pagination + stale cursor');
  console.log('LIVE POSTGRES PHASE 6B TESTS PASSED');
} finally {
  try { run(`DELETE FROM auth.users WHERE id IN (${q(USER_A)}::uuid, ${q(USER_B)}::uuid);`); } catch {}
}
