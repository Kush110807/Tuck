# Tuck competition Web deployment

The competition Web app is browser-local. It uses `WebLocalRepository` + IndexedDB and does not require Supabase, login, Mailpit, a Node server, or localhost after the static build is deployed.

## Local development

```bash
npm ci
npm run web
```

## Production static build

Root-host build:

```bash
npm run web:build
```

GitHub project-site build (`https://USER.github.io/REPO/`):

```bash
EXPO_PUBLIC_BASE_URL=/REPO npm run web:build
```

`app.config.js` maps `EXPO_PUBLIC_BASE_URL` to Expo's supported `experiments.baseUrl`, so bundled resources are emitted for the project subpath.

## GitHub Pages

1. Push the repository to GitHub and use `main` as the competition branch.
2. Open **Repository → Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Push to `main` or run **Deploy Tuck Web to GitHub Pages** manually from Actions.
5. The workflow installs with `npm ci`, runs the verification suite, exports the Web SPA with the repository base path, uploads `dist-web`, and deploys through the official Pages actions.

No deployment credential is stored in the repository.

## Reset browser data for testing

Use browser DevTools:

**Application → Storage → IndexedDB → `tuck-web-local` → Delete database**

Reload the page. The tasteful first-run examples will be seeded once into the new database. Deleting examples inside Tuck does not cause them to reappear on ordinary refresh/reopen because the seed-complete flag is persisted in IndexedDB.
