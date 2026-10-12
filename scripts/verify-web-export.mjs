#!/usr/bin/env node
/**
 * Verify that an Expo static web export contains an entry point and resolvable
 * local script, stylesheet, icon, and preload URLs. No dependencies/network.
 * Usage: node scripts/verify-web-export.mjs [dist-directory] [base-path]
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function normalizeBasePath(value = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || /[?#\\]/.test(value)) {
    throw new Error('The deployment base path must begin with / and contain no query, fragment or backslash.');
  }
  if (value.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new Error('The deployment base path cannot contain . or .. segments.');
  }
  return value === '/' ? '/' : `/${value.split('/').filter(Boolean).join('/')}/`;
}

function decodeSafePath(value) {
  let decoded;
  try { decoded = decodeURIComponent(value); }
  catch { throw new Error(`Malformed encoded local asset path: ${value}`); }
  if (decoded.includes('\\') || decoded.includes('\0')) throw new Error('Unsafe asset path.');
  return decoded;
}

export function verifyWebExport(directory, basePath = '/') {
  const base = normalizeBasePath(basePath);
  const root = path.resolve(directory);
  const index = path.join(root, 'index.html');
  const errors = [];
  if (!existsSync(index) || !statSync(index).isFile()) {
    return { passed: false, checked: 0, errors: [`Missing static entry point: ${index}`] };
  }
  const html = readFileSync(index, 'utf8');
  if (/<script\b[^>]*\bsrc\s*=/.test(html) === false) {
    errors.push('No external JavaScript bundle referenced in index.html.');
  }
  if (/(https?:\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|\b)/i.test(html)) {
    errors.push('HTML includes a localhost-only dependency.');
  }
  const regex = /<(?:script|link|img)\b[^>]*\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi;
  let match;
  let checked = 0;
  while ((match = regex.exec(html)) !== null) {
    const originalUrl = match[2].trim();
    if (!originalUrl || /^(?:data:|https?:\/\/|mailto:|blob:|#|\/\/)/i.test(originalUrl)) continue;
    let pathname;
    try { pathname = decodeSafePath(originalUrl.split(/[?#]/, 1)[0]); }
    catch (error) { errors.push(`${originalUrl}: ${error.message}`); continue; }
    if (!pathname) continue;
    // Expo normally emits absolute same-origin URLs; relative URLs work too.
    if (pathname.startsWith('/') && base !== '/' && !pathname.startsWith(base)) {
      errors.push(`${originalUrl} escapes the expected project base path ${base}`);
      continue;
    }
    const relative = pathname.startsWith('/') ? pathname.slice(base.length) : pathname;
    const asset = path.resolve(root, relative);
    if (asset !== root && !asset.startsWith(root + path.sep)) {
      errors.push(`Asset escapes export directory: ${originalUrl}`);
      continue;
    }
    checked++;
    if (!existsSync(asset) || !statSync(asset).isFile()) {
      errors.push(`Referenced local asset not found: ${originalUrl} → ${asset}`);
    }
  }
  if (checked === 0) errors.push('No local referenced assets were found to verify.');
  return { passed: errors.length === 0, checked, errors };
}

const directlyInvoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (directlyInvoked) {
  const dist = process.argv[2] ?? 'dist-web';
  const base = process.argv[3] ?? process.env.EXPO_PUBLIC_BASE_URL ?? '/';
  const result = verifyWebExport(dist, base);
  for (const error of result.errors) console.error(`ERROR: ${error}`);
  console.log(`Web export verification: ${result.passed ? 'PASS' : 'FAIL'} (${result.checked} local references checked; base ${normalizeBasePath(base)})`);
  if (!result.passed) process.exitCode = 1;
}
