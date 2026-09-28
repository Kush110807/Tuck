# Phase 4 evidence notes

These files are execution logs from the master repair workspace for the repaired candidate. They are intentionally separated by evidence layer.

- `original-*.log` — reproductions against the exact audited Phase 2 source (`9ab9be2`) or the preserved independent audit harness. A successful reproduction is evidence of the old defect, not of the repair.
- `repaired-core-scenarios-final.log` — repaired controller scenarios compiled from production controller source with committed controller mocks.
- `repository-maintenance-scenarios-final.log` — repaired `SQLiteItemRepository` initialization/maintenance behavior with a mocked Expo SQLite/image-store boundary. This is not a real Expo SQLite execution.
- `image-validation-scenarios-final.log` — repaired `PersistentImageStore` JPEG/PNG/WebP content validation with a mocked Expo filesystem and injected image decoder.
- `render-fallback-scenario-final.log` — pure production image-presentation fallback rules after a renderer error.
- `image-order-scenarios-final.log` — repository image replacement/delete ordering against mocked SQLite/image-store boundaries.
- `picker-scenarios-final.log` — repaired ImagePicker adapter behavior with an injected API boundary.
- `supplemental-core-tsc-final.log` and `changed-syntax-final.log` — dependency-free source checks; neither replaces the canonical project typecheck.
- `npm-ci-*.log`, `typecheck-final.log`, `test-final.log`, `export_android-final.log`, `expo_check-final.log` — canonical install/tooling attempts and exact blockers.
- `git-integrity-final.log`, `package-lock-final.log`, `source-hygiene-final.log`, `artifact-secret-scan-final.log` — pre-documentation-commit repository checks. Git/hygiene checks are rerun again before packaging the final repair SHA.
- `environment-final.log` — observed local toolchain.

The authoritative Phase 3 audit artifact is preserved one directory above as `Tuck_Phase3_Independent_Audit_9ab9be2.zip`.
