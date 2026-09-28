# Phase 6A Deterministic Reference Model

`src/sync/reference/FakeSyncServer.ts` is a deliberately non-networked executable specification. It is not a backend client and is not production sync code.

It models:

- account scope;
- canonical Items/Collections/assets;
- integer entity versions;
- global monotonic change sequence;
- mutation idempotency and request-hash reuse rejection;
- immutable full-snapshot change payloads;
- account-lifetime tombstones;
- push conflict policies;
- frozen bootstrap sessions;
- bounded pull targets;
- retention floor / `rebootstrap_required`.

`src/sync/profileState.ts` models profile/account visibility, sign-in/out, session generation and safe cache-removal decisions without touching actual storage.

`src/sync/assetState.ts` models image transfer/cache states without uploading/downloading files.

## Deterministic two-device pattern

Tests model:

```text
Device A mutation(s)
        ↓
FakeSyncServer
        ↑
Device B stale-base mutation(s)
```

No wall-clock ordering decides correctness. Tests may deliberately supply absurd domain timestamps while entity versions still control conflict behavior.

## Required 6A coverage mapping

- local mutation serialization → `protocol.test.ts`
- duplicate mutation / same retry → `fakeServer.test.ts`
- out-of-order old retry → `fakeServer.test.ts`
- version mismatch + disjoint edit → `fakeServer.test.ts`
- body/body + title/title conflict → `fakeServer.test.ts`
- tag three-way merge → both sync test files
- pin vs pin → `fakeServer.test.ts`
- archive vs restore → `fakeServer.test.ts`
- content edit vs archive → `fakeServer.test.ts`
- Collection rename conflict → `fakeServer.test.ts`
- Collection delete vs assignment → `fakeServer.test.ts`
- Item delete vs offline edit / stale delete → `fakeServer.test.ts`
- second-device bootstrap → `fakeServer.test.ts`
- mutation during bootstrap → `fakeServer.test.ts`
- interrupted bootstrap resume → `fakeServer.test.ts`
- repeated pull → `fakeServer.test.ts`
- expired cursor → `fakeServer.test.ts`
- completely wrong device clock → `fakeServer.test.ts`
- malformed mutation → `fakeServer.test.ts`
- wrong-account attempt → `fakeServer.test.ts`
- account switch/logout with unsynced outbox → `mergeProfileAsset.test.ts`
- remote asset known but not downloaded → `mergeProfileAsset.test.ts`
- conflict-copy semantics → `mergeProfileAsset.test.ts`

Later phases still require real PostgreSQL/Supabase integration tests for RLS, RPC privilege hardening, Storage policies and transaction behavior. Passing the fake model is necessary but cannot prove those deployed properties.
