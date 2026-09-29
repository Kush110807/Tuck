# Competition architecture

The competition build deliberately uses two independent local-first product surfaces.

## Web — primary showcase

`App.web.tsx → WebTuckApp → WebLocalRepository → IndexedDB`

There is no competition-path authentication, Supabase configuration, cloud polling, or cross-device synchronization. Notes, links, Collections, tags and browser-local image Blobs persist in the versioned `tuck-web-local` IndexedDB database. A one-time seed gives a new judge a small, tasteful library instead of an empty shell.

## Android

`App.tsx → NativeTuckApp → createTuckDataLayer() → SQLite`

Android opens directly into the accepted mature local Tuck workspace. It does not instantiate AuthService, SyncEngine, Supabase transports, or account-profile cloud mode for the competition.

## Preserved future-launch engineering

The repository still contains the accepted Phase 6B/6C/6D cloud foundation: Supabase migrations/RPC/RLS, AuthService, SyncEngine, transports, WebCloudClient, SQLite v3, durable outbox, account profiles, tombstones and Asset protocol/tests. The competition entry points simply do not activate those paths.
