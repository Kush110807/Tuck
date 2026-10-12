import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeBasePath, verifyWebExport } from '../../scripts/verify-web-export.mjs';

function fixture(html, files = []) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tuck-export-'));
  writeFileSync(path.join(root, 'index.html'), html);
  for (const file of files) {
    const dest = path.join(root, file);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, 'ok');
  }
  return root;
}

test('accepts root export with existing local JS and icon', () => {
  const root = fixture('<script src="/_expo/app.js"></script><link rel="icon" href="/favicon.ico">', ['_expo/app.js', 'favicon.ico']);
  try { assert.deepEqual(verifyWebExport(root, '/'), { passed: true, checked: 2, errors: [] }); }
  finally { rmSync(root, { recursive: true }); }
});

test('accepts project export with subpath and query string', () => {
  const root = fixture('<script src="/Tuck/_expo/app.js?v=1"></script>', ['_expo/app.js']);
  try { assert.equal(verifyWebExport(root, '/Tuck').passed, true); }
  finally { rmSync(root, { recursive: true }); }
});

test('rejects root-relative assets that break a GitHub project site', () => {
  const root = fixture('<script src="/_expo/app.js"></script>', ['_expo/app.js']);
  try { assert.match(verifyWebExport(root, '/Tuck').errors.join(' '), /escapes.*base path/); }
  finally { rmSync(root, { recursive: true }); }
});

test('rejects missing assets and local development dependencies', () => {
  const root = fixture('<script src="http://localhost:8081/index.bundle"></script><script src="/_expo/missing.js"></script>');
  try {
    const result = verifyWebExport(root);
    assert.equal(result.passed, false);
    assert.match(result.errors.join(' '), /localhost-only/);
    assert.match(result.errors.join(' '), /not found/);
  } finally { rmSync(root, { recursive: true }); }
});

test('rejects unsafe base paths and escape attempts', () => {
  assert.throws(() => normalizeBasePath('/a/../b'), /cannot contain/);
  assert.throws(() => normalizeBasePath('Tuck'), /begin/);
  const root = fixture('<script src="../../secret.js"></script>');
  try { assert.equal(verifyWebExport(root).passed, false); }
  finally { rmSync(root, { recursive: true }); }
});

test('rejects missing index', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tuck-no-index-'));
  try { assert.equal(verifyWebExport(root).passed, false); }
  finally { rmSync(root, { recursive: true }); }
});
