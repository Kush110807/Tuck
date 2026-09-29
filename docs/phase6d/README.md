# Phase 6D-MVP — Competition Cross-Device Sync

Phase 6D is the final competition implementation phase. It keeps Android local-first and connects the frozen Phase 6C durable SQLite/outbox layer to the frozen Phase 6B authenticated RPC/Storage protocol through one `SyncEngine.runOnce()` path. The browser client is intentionally cloud-first.

## Competition architecture

- **Android:** SQLite remains authoritative for immediate UI. Successful local CRUD returns before network work. `SyncTriggerRepository` schedules the same `SyncEngine.runOnce()` after the local transaction commits.
- **Sync engine:** bootstrap (when required) → Asset dependency upload → durable outbox push → atomic canonical-result persistence/ack → finite-target pull → atomic remote apply/cursor → lazy Asset download.
- **Backend:** unchanged Phase 6B RPC/RLS/Storage security model. Clients use only the public Supabase key plus the signed-in user's JWT.
- **Web:** responsive React Native Web surface backed by `WebCloudClient`. It bootstraps/pulls canonical cloud state, pushes mutations through the Phase 6B RPC, refreshes after writes/focus/visibility and polls every three seconds while visible.
- **Images:** Android persists the local image immediately. Sync creates/finalizes the Phase 6B Asset and uploads bytes to the private bucket before the dependent Item mutation. Android/Web download private ready Assets lazily and cache them by stable Asset ID.

## Auth and redirect setup

Android magic-link callback: `tuck://auth/callback`.

Local Expo Web normally runs at `http://localhost:8081`; local Supabase config includes that origin (and `127.0.0.1`) in `additional_redirect_urls`. For a hosted competition web build, add the exact deployed HTTPS URL to **Supabase Auth → URL Configuration → Redirect URLs**. Do not put a service-role key, database password, JWT signing secret, or admin credential in either client.

Set the public client environment:

```text
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<public anon/publishable key>
```

The same public values are used by Android and web. Authorization comes from the authenticated JWT plus the frozen Phase 6B RPC/RLS policies.

## Demo run

1. Start/use the accepted Phase 6B Supabase project and ensure migrations are already applied.
2. Run Android with `npm run android` (or the normal Expo device flow).
3. Run the laptop client with `npm run web`.
4. Sign in to both with the same competition account.
5. Android: create a Note. Save should close/update immediately; the compact sync bar progresses Saved → Syncing… → Synced.
6. Web: confirm the Note appears, edit it and pin it. Android polling/foreground/manual retry converges to the change.
7. Android: create an image Item. The local image remains usable immediately while Asset upload/finalize runs; Web lazily renders the ready private image.
8. Put Android offline, create/edit an Item, optionally restart, then reconnect. The durable mutation retains its UUID and drains on a subsequent foreground poll/retry.
9. Exercise Collection assignment, archive/restore and hard delete; the other client should converge and deleted entities must not resurrect.

## Competition-MVP error behavior

- Network/5xx failure: local Android data remains committed; outbox work remains durable and retryable.
- Image upload failure: Item/local bytes remain available and Asset state remains retryable.
- Image download failure: metadata remains; UI keeps a placeholder and retries on demand.
- Stale pull cursor: engine resets/rebootstraps only when safe, then resumes the same finite pull flow.
- Auth refresh failure/sign-out: tokens are removed locally; local-only mode remains available.
- Authored conflict: canonical server state is applied and Android creates a local authored conflict copy when the frozen policy allows it; lightweight feedback says both versions were kept. Web keeps the editor draft open if its cloud mutation conflicts.

## Intentionally deferred beyond the competition MVP

No WebSocket/Realtime system, web offline database, multi-account switcher, advanced conflict-diff UI, image GC/CDN/thumbnail pipeline, background job framework, production monitoring/telemetry, or store-deployment hardening is included.

## Verification

Canonical repository gate:

```text
npm ci
npx expo install --check
npm run typecheck
npm test
npm run export:android
git status --short
git diff --check
git fsck --full
```

Because Phase 6D adds real auth/network/image behavior, the final competition freeze also requires physical-device QA plus the Android↔Supabase↔Web golden demo. Do not report either as passed without actually running it.
