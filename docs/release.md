# Build and verification gates

## Current Phase 1A evidence

The physical Android phone is **available by user confirmation**. Its model and Android version have not been provided. No physical-phone check, native launch or APK build has passed yet. This environment has Node, npm, Java and Git; `adb`, Android emulator and Android SDK were not discovered at scaffold time. Type checks and Node tests can run here; they do not prove device operation.

## Early phone route

Install a compatible Expo Go app on the phone, connect phone and Metro host to the same network, run `npm ci` then `npm start`, and scan the QR code. Confirm the four scaffold placeholders can be navigated and record the phone model/Android version and actual outcome. If LAN discovery fails, diagnose the connection; do not claim a pass from a QR code alone. The eventual final APK must be installed and tested separately.

## APK route

Use an Expo account and EAS build access, connect the project through the official CLI, and run `npx eas-cli build -p android --profile preview`. The `eas.json` preview profile requests an installable APK. Download it, record build ID, source SHA and checksum, install it on the confirmed physical phone, then test the exact installed revision. Account/build access is currently unverified. A local Android SDK build machine is an alternate route. Never ask for credentials in chat or commit signing keys.

## Submission gates

After Phase 1 and integration, run `npm ci`, `npm run typecheck`, `npm test`, an Android bundle/build, installed-device journeys and force-close/relaunch. An independent reviewer who did not implement the app records Phase 3 results in `docs/independent-audit.md`; master repairs confirmed defects and retests on a new build. Record repo SHA, build log/ID, APK link/hash, device/OS, dated outcomes and known limits. Source ZIP, placeholder preview, type-check or green unit tests alone do not constitute a release. The portal's accepted demo link format and exact deadline remain to be verified when it opens.
