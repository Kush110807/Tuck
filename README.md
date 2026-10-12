# Tuck — save it now, find it later

**Competition MVP · Folded-note visual identity · Local-first on Android and web**

Tuck is a save-for-later workspace for **notes, links and images**. Capture an idea, group it in a Collection, add tags, find it by search, pin it or put it in Archive. The accepted competition edition is deliberately quick to use without a login screen or an always-on server.

## BYTE App Development — Submission Summary

**Stage reached:** Stage 1 — Build the Local App.

**Tech stack:** TypeScript, React Native, Expo SDK 57, Expo SQLite, Expo FileSystem, Expo ImagePicker, React Native Web and IndexedDB.

**Architecture:**

```text
Android App (Expo / React Native)
              |
       UI & Controllers
              |
    SQLite + Local Images

Web Demo (React Native Web)
              |
        Web Application
              |
   IndexedDB + Image Blobs
```

**Technical decisions:** Tuck prioritises fast local saves, offline usability, persistent storage and a straightforward interface. Android and web operate independently without a required backend or login.

**Known limitations:** Cross-device synchronization and mobile Share Into App are not enabled in the competition build. Browser data is tied to the browser profile and may be lost if site storage is cleared.

The Android APK and web showcase can run without the developer's laptop or development server.

## What's in the competition build

| Platform | Entry point | Persistence | Can run without the developer laptop? |
|---|---|---|---|
| Web showcase | `App.web.tsx` | Browser IndexedDB (`tuck-web-local`) | Yes, after static deployment |
| Android app | `App.tsx` | Device SQLite and app-owned image files | Yes, after installing a **standalone APK** |

A new browser profile starts with a small one-time example library. Judges can create, edit, archive, search and delete their own items. These changes are stored in **that browser profile only**. Android stores its own local data. **Items are not synchronized between Android and web in the competition entry points.**

The repository includes experimental/future Supabase Auth, PostgreSQL, RLS, Storage and sync code from Phases 6B–6D. These paths are intentionally **not activated** by the competition application entry points. Do not describe the competition demo as a live cloud-synced product.

## Features

- Notes, links, images; create, inspect, edit and delete
- Collections, tags, search, filters, pin and Archive/restore
- Local persistence across restarts on the same device/browser profile
- Responsive web workspace and Android-first mobile UI
- Browser-local image blobs and Android-owned persistent image files
- Calm neutral/forest-green visual system with folded-note mark

## Prerequisites

Node **22.16.0** and npm 10+ are the pinned development environment. The repository contains `package-lock.json`. A complete online package installation is necessary on a fresh machine.

```bash
npm ci
npm run release:check
npx expo install --check
npm run typecheck
npm test
```

## Run for development

```bash
npm run web      # Metro development server for browser
npm run android  # Expo development flow for Android
```

These commands **do require** a running development server/CMD session. They are not how judges should launch a published app.

## Publish the standalone web showcase

```bash
EXPO_PUBLIC_BASE_URL=/Tuck npm run web:build   # bash / GitHub Actions
npm run web:verify -- /Tuck
```

On Windows PowerShell:

```powershell
$env:EXPO_PUBLIC_BASE_URL = '/Tuck'
npm run web:build
npm run web:verify -- /Tuck
```

The repository contains `.github/workflows/pages.yml`, which builds and deploys automatically on pushes to `main` **after GitHub Pages is configured to use GitHub Actions**. The workflow runs tests and validates the deployed export's asset URLs. Expected project-site address after a successful deploy: `https://kush110807.github.io/Tuck/` (**do not assume this is live until verified**).

For a site hosted at a domain root, build without `EXPO_PUBLIC_BASE_URL` and verify with `/`.

## Build a standalone Android APK

`npm run export:android` exports JavaScript and assets. **It does not produce an installable APK.** Build an actual signed preview APK using an Expo/EAS account linked to the project:

```bash
npm ci
npm run typecheck
npm test
npx expo install --check
npx eas-cli@latest build --platform android --profile preview
```

`eas.json` requests an internal-distribution APK. Download the APK from the completed EAS build, install it on a real Android device, and test cold start, restart, airplane mode, and CRUD. Once installed, it will **not need CMD, Metro, or the developer's laptop** to launch.

## Release and submission

See [deployment runbook](docs/competition/WEB_DEPLOYMENT.md), [release verification](docs/release.md), and [submission checklist](docs/competition/SUBMISSION_CHECKLIST.md). Keep public demo credentials, secrets and private user data out of the repository and submissions. The browser demo intentionally stores content locally; clearing site data, using another browser, or using private/incognito mode may lose/hide content.

### Repository layout

- `src/web/` — competition browser client and IndexedDB repository
- `src/app/NativeTuckApp.tsx`, `src/data/` — Android competition client and SQLite/image foundation
- `src/ui/`, `src/controllers/`, `src/domain/` — Android UI, orchestration, and domain rules
- `src/auth/`, `src/sync/`, `supabase/` — preserved future cloud infrastructure (not on competition entry path)
- `tests/` — application tests, including dependency-free release export tests
- `docs/competition/` — product architecture, visual QA, web deployment and submission guide

## Known limitations

This is **not** a multi-user cloud notebook, extension, AI assistant or collaborative editor. Browser data is device/profile-specific; web storage can be evicted by browser policy. Native APK generation and deployment require external signing/build infrastructure; a JavaScript export is not a replacement. See the release report for **verified versus blocked** checks.

## License notice

The existing `LICENSE` file is the inherited Expo template license (its copyright holder is Expo / 650 Industries). It must **not** be presented as a confirmed license for the original Tuck application code. The repository owner should choose/approve the project's own license or distribution terms before granting reuse rights.
