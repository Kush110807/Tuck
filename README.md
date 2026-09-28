# Tuck — BYTE App Development

**Phase 1A master scaffold only.** The app currently displays four clearly labelled placeholder routes. It does not yet save items, access SQLite, pick images, or open saved links. This repository targets the BYTE Stage 1 local app brief: https://bytesoc.dev/tasks/app-dev/.

## Scope and baseline

Android-first, local notes, links and images; Inbox, Editor, Detail, Archive; text search, type and tag filters. No AI, login, backend, sync, archive undo, or Share-menu receiver. See [contract rules](docs/CONTRACT_RULES.md) and [workstream ownership](docs/WORKSTREAMS.md). The master records the Phase 1A baseline SHA after checks; every workstream must start from that same commit.

The user confirmed access to a physical Android phone. Its model, Android version, and any test result are still unknown. An APK build and installed-app test have **not** been completed.

## Setup and commands

Prerequisites: Node.js 24 (the scaffold was created using v24.19.0), npm, an Android phone with a compatible Expo Go client for early testing, and a network connection between phone and Metro. If using a local Android emulator or native build, install and configure the Android SDK separately.

```sh
npm ci
npm run typecheck
npm test
npm start
```

On the phone, install Expo Go from its official distribution channel, put it on the same network as the development computer, and scan the QR code from `npm start`. Open Inbox, Editor, Detail and Archive. This verifies only the placeholder navigation until real screens are integrated. Do not claim app functions pass from this check. `npm run android` requires a configured Android SDK/adb on the host; it was not available in the scaffold environment.

## Build route

The proposed installable Android build is Expo EAS with the `preview` profile in `eas.json` (`android.buildType: apk`). After connecting a project to an Expo account and configuring build credentials through the official CLI, run `npx eas-cli build -p android --profile preview`, download the APK, install it on the physical phone and test the exact candidate revision. An Expo account and EAS build access have **not** been verified. A local Android SDK build is an alternative on a suitably configured machine. Do not commit credentials, keystores, or generated native builds. See [release gates](docs/release.md).

## Technical decisions and known limits

Expo SDK 57 template; React Native and TypeScript; native-stack navigation. Compatible Expo native module ranges were selected through `EXPO_OFFLINE=1 npx expo install` when Expo's compatibility service timed out; exact installations are recorded in `package-lock.json`. SQLite and app-owned image files are contracts only at this stage. The sample image and fixture values are test/preview material, never user data. The stock Expo launcher artwork is temporary and must be replaced before submission.

Known issues at Phase 1A: all screens are placeholders; no installed-device result; build-account access unconfirmed; portal's accepted demo format and closing time unverified. The organiser requires repository history, a runnable method, README, and architecture diagram; a ZIP or a successful type check is not a finished app.
