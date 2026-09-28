# Ownership and Phase 1 workstream handoff

**Baseline:** use the Git commit SHA reported with the Phase 1A handoff. All three workstreams checkout the same SHA. The ZIP containing this repository is a transport copy, not a separate version of the spec. No workstream has been launched by the scaffold.

| Path | Single implementation owner |
|---|---|
| `App.tsx`, `index.ts`, `app.json`, `eas.json`, `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, root configuration and launcher artwork | Master |
| `src/contracts/**`, `src/theme/**`, `src/navigation/**`, `src/preview/**`, `assets/fixtures/**` | Master |
| `src/ui/**` | A: presentational UI |
| `src/domain/**`, `src/data/**` including SQLite/file adapters | B: domain and persistence |
| `src/controllers/**` including picker/link adapters | C: controllers |
| `tests/scaffold/**` | Master |
| `tests/fixtures/**`, `tests/mocks/**`, other `tests/**` | C |
| `README.md`, `docs/architecture.md`, `docs/CONTRACT_RULES.md`, `docs/WORKSTREAMS.md`, `docs/release.md` | Master |
| `docs/qa-plan.md` | C |
| `docs/independent-audit.md` | Separate Phase 3 reviewer, who implements no app code |
| Build artefacts and final package | Master |

Any new file must fall under its owner's path, or master assigns it explicitly. Shared contract, token, route, dependency or build changes go through master, with a new commit and notification to A, B and C. A and C may use `src/preview/**` for visual development but must not edit it or import it into production `App.tsx`. C's test mocks live only in `tests/mocks/**`. Phase 2 removes preview wiring from any integrated app path. The master owns cross-screen `MutationMailbox`, C publishes/consumes through its interface.

## A — UI / visual / product (copyable brief)

```text
Start from the exact Phase 1A baseline SHA supplied by master. Read
src/contracts/index.ts, src/theme/tokens.ts and docs/CONTRACT_RULES.md.
Own src/ui/** only.

Implement presentational Inbox, Editor, Detail and Archive screens and all
declared shared components. Consume exact props and callbacks. Render every
loading, ready, missing, failed, empty, no-match, pending, feedback and
confirmation state. An ItemCard receives an ItemListRow with a resolved image
state. Editor reads the EditorState union, including retry and unsaved-discard
confirmation. Support large text, screen readers, labelled controls and
44 pt minimum touch areas.

No SQLite, picker, browser, navigation, fixture seeding or product features in
UI components. Do not edit master, B or C files. Request shared changes from
master. Hand back owned files, visual state inventory, previews and unresolved
issues. Acceptance: every state renders from supplied props; controls call
the typed callbacks without depending on persistence or network.
```

## B — logic / data (copyable brief)

```text
Start from the exact Phase 1A baseline SHA supplied by master. Read
src/contracts/index.ts and docs/CONTRACT_RULES.md. Own src/domain/** and
src/data/** only, including SQLite and persistent ImageStore adapters.

Implement validation, normalization, combined retrieval, deterministic sort,
local CRUD, archive/restore, optimistic timestamp checks, migration/init,
durable image copy/replace/delete and queued cleanup in the specified order.
Map failures to Result/AppError; a missing image does not hide item metadata.
Never seed preview/test fixture data in production. Do not change contracts,
navigation, dependencies, screens or controllers; request changes from master.

Hand back code, schema/migration notes, operation/error matrix and remaining
risks. Acceptance: contract methods and failure rules are satisfied, and a
failed commit is never displayed as a saved item.
```

## C — interaction / QA preparation (copyable brief)

```text
Start from the exact Phase 1A baseline SHA supplied by master. Read
src/contracts/index.ts, docs/CONTRACT_RULES.md and the master-owned
MutationMailbox/navigationActions interfaces. Own src/controllers/**,
tests/fixtures/**, tests/mocks/**, non-scaffold tests and docs/qa-plan.md.

Implement the controllers joining A's props to B's repository. Build
ItemListRow image states through ImageStore resolution. Handle editor
load/retry/missing/dirty/discard states, image selection and cancellation,
pending guards, conflict feedback, deletion confirmation, search generation
races and post-success mutation notices. Publish only after confirmed writes;
destination controllers consume on focus, refresh and show feedback. Implement
picker and external-link adapters in src/controllers/adapters/**.

Prepare meaningful tests and a device QA matrix, marking anything not run.
Do not alter shared contracts, navigation implementation, preview mocks,
tokens or dependencies. Hand back owned code, tests, commands, QA plan and
results. C may perform integration QA later but cannot be the independent
Phase 3 reviewer.
```
