# Phase 6A Auth / RLS / RPC Security Contract

No security mechanism in this document is deployed by Phase 6A. This freezes the requirements for Phase 6B+.

## Client credential rule

Android/web bundles may contain only normal public project configuration and user-session credentials. They must never contain:

- Supabase service-role key;
- Postgres password;
- database-owner/admin credentials;
- Storage admin credentials.

Every sync RPC uses a normal authenticated user JWT. The authenticated identity is derived server-side with `auth.uid()`.

## Account scope rule

Protocol requests include `accountId` for explicit contract/debugging clarity, but it is **never authority**. For every RPC:

1. `auth.uid()` must be non-null;
2. request `accountId` must equal `auth.uid()`;
3. every entity query/mutation includes `user_id = auth.uid()`;
4. entity IDs never authorize access by themselves;
5. a cross-user entity ID attempt returns a non-enumerating wrong-account/not-found response and must not reveal the other owner's data.

## Direct table access

The proposed schema enables RLS on public user-owned tables as defense in depth. Direct DML for `anon` and `authenticated` is revoked. Android/web synchronization goes through the versioned RPC contract only.

Private protocol tables (`sync_changes`, `processed_mutations`, tombstones, bootstrap sessions/entries) are not exposed to client roles.

## RPC execution model

`bootstrap`, `pull_changes` and `push_mutations` are planned as tightly scoped PostgreSQL RPC functions implemented as `SECURITY DEFINER` because they must atomically access private protocol tables while client roles have no direct permission.

Required hardening for every such function:

- function owner is a dedicated `NOLOGIN` role with only the required table privileges;
- `REVOKE EXECUTE ... FROM PUBLIC, anon`;
- `GRANT EXECUTE ... TO authenticated` only;
- fixed function `search_path` (for example `pg_catalog, public, private`) and schema-qualified use of `auth.uid()`;
- no dynamic SQL from client strings;
- no trust in a client-supplied `user_id`, storage path, server version or sequence outside the validated protocol fields;
- validate protocol version before doing work;
- validate entity IDs are non-empty, bounded (`<=128` code units in the transport contract) and contain no control characters;
- validate mutation IDs as UUIDs;
- reject mutation UUID reuse with a different request hash;
- every read/write is scoped to the authenticated user explicitly even though the function is privileged;
- unexpected function error rolls back the entire RPC transaction.

A batch may return per-mutation validation/conflict results by using controlled PL/pgSQL subtransactions/savepoints. An unexpected server exception must not leave a partially committed RPC transaction.

## RLS expectations

RLS policies permit only `user_id = auth.uid()` rows when direct SELECT is deliberately granted in a later phase. No policy may use a caller-supplied account value as ownership evidence.

The storage bucket is private. Storage object keys are server-derived as:

`<auth.uid()>/<assetId>/original.<validated-extension>`

Storage policy must require the first path segment to equal the authenticated user and must reject attempts to upload/read another user's prefix. Finalizing an asset as `ready` additionally verifies the `assets.user_id`, expected path, MIME type and bounded byte size.

## Authentication/logout security semantics

- Normal device sign-out revokes/clears the active local session and pauses that account profile; it does not delete its DB/outbox.
- Global sign-out requests server revocation of other refresh sessions, then hides every signed-in account profile locally.
- A late RPC response belongs to the session generation that initiated it. If logout/account switch increments the generation, that response is ignored and cannot write into the newly active profile.
- A remotely deleted account causes sync to stop. Pending local data is retained privately for explicit recovery/export; it must never recreate the deleted cloud account automatically.

## Transaction authorization

For `push_mutations`, ownership, base-version validation, per-account head-row lock/allocation, canonical mutation, version increment, change-log append and processed-mutation insert are one server transaction. A result cannot report success unless all those effects committed together.

For Collection delete, unfiling affected Items, their version/change entries, the Collection tombstone and Collection deletion are one transaction.

For `bootstrap`, the snapshot session, committed account head and materialized snapshot entries are created from one REPEATABLE READ MVCC view. The head must be read from `private.account_sync_heads` in the same snapshot as canonical entity reads; it is never inferred from `max(sync_changes.seq)` or an identity sequence.

## Data privacy boundary

Phase 6 uses TLS and provider/database/storage encryption controls but **not E2EE**. Server-side systems can therefore process user content. Product copy must not claim end-to-end encryption.
