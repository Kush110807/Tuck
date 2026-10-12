# Tuck — competition submission gate

Use the **exact committed release candidate**, not the old Phase 4 README or an unreviewed branch.

## Required artifacts

- [ ] Repository URL pointing to the final accepted source commit
- [ ] Successful CI result for the exact source commit (`npm ci`, Expo dependency check, typecheck, Vitest)
- [ ] Successful static export and export-asset validation
- [ ] Live HTTPS demo opened in Chromium; browser CRUD, refresh and persistence checked
- [ ] Responsive QA on desktop, tablet and narrow mobile widths
- [ ] Android preview APK built by EAS or a local signed Android build, if competition requires APK
- [ ] Android APK installed/tested on device; verify launch without Metro/CMD/laptop
- [ ] Project code licensing/distribution terms reviewed (existing `LICENSE` is inherited Expo-template text)
- [ ] Screenshots/demo recording taken from the **actual released app**, if required
- [ ] Clear statement: web/Android are local-only and **not cross-device synchronized** in competition mode
- [ ] Final portal form, repo link, hosted demo and any APK/video uploaded **before deadline**
- [ ] Submitted/accepted confirmation captured (screenshot/email)

## Evidence per release

Record in `docs/release.md` or the submission portal:

| Evidence | Value |
|---|---|
| Source commit SHA | |
| GitHub workflow run URL + conclusion | |
| Hosted URL + UTC verification time | |
| Native EAS build ID + APK SHA-256 | |
| Android model, version, offline/relaunch outcomes | |
| Desktop/mobile browser + viewport QA | |
| Submission ID / confirmation | |

If a required external check is not run, classify it **BLOCKED/NOT VERIFIED**, not PASS. A Git commit alone does not prove the live URL or an APK works.
