# Tuck competition web deployment

## What is being published

The accepted competition web app (`App.web.tsx → WebTuckApp → WebLocalRepository → IndexedDB`) is a **static**, browser-local showcase. It does **not** need an API server, Supabase project, cloud sync, or judge login. The hosted browser downloads its JavaScript and stores subsequent user data in that browser profile; closing the publishing developer's CMD does not stop the hosted app.

A site with no connection cannot fetch initial static files; an already loaded app may continue to work locally, but do **not** promise offline PWA installation/service-worker caching. Clearing browser storage or switching browsers loses access to that profile's local content. One-time seed examples appear only when a new database is initialized.

## Local verification

```bash
npm ci
npm run release:check
npx expo install --check
npm run typecheck
npm test
npm run web:build
npm run web:verify -- dist-web /
```

This needs working npm registry access and Node 22.16.0+. `npm run web` is for development only.

## GitHub Pages project site

The repository name is `Tuck`; the Pages project base path therefore is `/Tuck/`.

On Windows PowerShell:

```powershell
$env:EXPO_PUBLIC_BASE_URL = '/Tuck'
npm run web:build
npm run web:verify -- dist-web /Tuck
```

On bash:

```bash
EXPO_PUBLIC_BASE_URL=/Tuck npm run web:build
npm run web:verify -- dist-web /Tuck
```

`app.config.js` passes this base path to Expo's `experiments.baseUrl`. The dependency-free verifier checks the exported `dist-web/index.html` for matching project-path static assets and rejects localhost references or missing bundles. **It does not replace an actual hosted browser smoke test.**

## GitHub Actions publishing

1. Confirm the GitHub repository is `Kush110807/Tuck` and the desired release changes are committed/pushed to `main`.
2. In GitHub open **Settings → Pages → Build and deployment**. Set **Source: GitHub Actions**.
3. `.github/workflows/pages.yml` will run on push to `main`, or use its workflow-dispatch option.
4. Workflow performs release-script tests, `npm ci`, Expo compatibility check, TypeScript, Vitest, static Web export, base-path/asset verification, then uploads/deploys with the official Pages actions.
5. Confirm a **successful** workflow and open `https://kush110807.github.io/Tuck/` in a new private browser session. Do not rely on the presence of a workflow YAML as evidence that Pages is enabled.
6. Verify that JS/CSS/assets load without 404s, the first-run examples appear, a test note survives refresh and browser reopen, and search/Collections/archive work.
7. Check at approximately 1440px, 1024px, 768px and 390px widths; confirm the editor does not cover actions and navigation remains reachable.

The workflow uses GitHub's `GITHUB_TOKEN` with `pages:write`/`id-token:write` and no checked-in publishing credentials.

## Hosting at a root domain

Do not set `EXPO_PUBLIC_BASE_URL`; build with `npm run web:build`, then run `npm run web:verify -- dist-web /`. Upload the contents of `dist-web` to a static host that serves `index.html` at the root. Root and project-site exports are **not interchangeable**.

## Browser QA and limitations

- First browser open and refresh after deployment
- Create/edit/delete Note and Link; visit Collection, pin and archive
- Add an image and confirm it survives refresh in the same browser profile
- Check absence of missing scripts/styles/icons in Network tab
- Reopen after the laptop and CMD are closed (hosted URL must still work)
- Test a second browser; data should be independent, not silently synced
- Avoid using a private/incognito profile for content meant to persist
- No credentials, cross-device sync or cloud-backup claims in marketing/submission

If a new visit loads HTML but shows a blank page, first inspect browser console and whether every `/_expo` asset URL includes the expected `/Tuck/` prefix.
