'use strict';

/**
 * Minimal env-based locale loader for the gsd-omp host CLI.
 *
 * Layering: the OMP runtime extension (src/extension.cjs) localizes its output
 * through the project config field `response_language` (see usesChinese(cwd)).
 * That is the correct layer for runtime messages because the extension runs
 * inside an OMP session with a project cwd.
 *
 * The install/doctor/descriptor CLI (bin/gsd-omp.cjs) and the EoS bootstrap
 * (src/eos.cjs) run from the shell with no project context, so they follow the
 * POSIX convention instead: GSD_OMP_LOCALE -> LC_ALL -> LC_MESSAGES -> LANG.
 *
 * Two locales ship: `en` (default) and `zh-CN`. Any value whose lowercase form
 * starts with `zh` resolves to `zh-CN`; everything else falls back to `en`.
 */

const path = require('node:path');

const SUPPORTED = Object.freeze(['en', 'zh-CN']);
const DEFAULT_LOCALE = 'en';

function normalize(raw) {
  if (!raw) return DEFAULT_LOCALE;
  const lower = String(raw).toLowerCase();
  if (lower.startsWith('zh')) return 'zh-CN';
  return DEFAULT_LOCALE;
}

function detectFromEnv(env = process.env) {
  return normalize(env.GSD_OMP_LOCALE || env.LC_ALL || env.LC_MESSAGES || env.LANG);
}

let current = detectFromEnv();
const cache = new Map();

function load(locale) {
  if (!cache.has(locale)) {
    cache.set(locale, require(path.join(__dirname, 'locales', `${locale}.cjs`)));
  }
  return cache.get(locale);
}

function setLocale(locale) {
  current = normalize(locale);
}

function getLocale() {
  return current;
}

function t(key, params) {
  let template = load(current)[key];
  if (template === undefined) template = load(DEFAULT_LOCALE)[key];
  if (template === undefined) return key;
  if (!params) return template;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => (
    params[name] !== undefined && params[name] !== null ? String(params[name]) : `{${name}}`
  ));
}

module.exports = Object.freeze({
  t,
  setLocale,
  getLocale,
  normalize,
  detectFromEnv,
  SUPPORTED,
  DEFAULT_LOCALE,
});
