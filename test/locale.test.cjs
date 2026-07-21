'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const locale = require('../src/locale.cjs');
const en = require('../src/locales/en.cjs');
const zhCN = require('../src/locales/zh-CN.cjs');

test('locale module exposes a frozen public surface', () => {
  assert.equal(typeof locale.t, 'function');
  assert.equal(typeof locale.setLocale, 'function');
  assert.equal(typeof locale.getLocale, 'function');
  assert.equal(Object.isFrozen(locale), true);
});

test('normalize maps any zh* variant to zh-CN and everything else to en', () => {
  assert.equal(locale.normalize('zh_CN.UTF-8'), 'zh-CN');
  assert.equal(locale.normalize('zh_TW'), 'zh-CN');
  assert.equal(locale.normalize('zhongguo'), 'zh-CN');
  assert.equal(locale.normalize('en_US.UTF-8'), 'en');
  assert.equal(locale.normalize('fr_FR'), 'en');
  assert.equal(locale.normalize('C'), 'en');
  assert.equal(locale.normalize(''), 'en');
  assert.equal(locale.normalize(undefined), 'en');
});

test('detectFromEnv follows GSD_OMP_LOCALE -> LC_ALL -> LC_MESSAGES -> LANG', () => {
  assert.equal(locale.detectFromEnv({ GSD_OMP_LOCALE: 'zh_CN.UTF-8', LANG: 'en_US.UTF-8' }), 'zh-CN');
  assert.equal(locale.detectFromEnv({ GSD_OMP_LOCALE: 'en', LANG: 'zh_CN.UTF-8' }), 'en');
  assert.equal(locale.detectFromEnv({ LC_ALL: 'zh_CN.UTF-8', LANG: 'en_US.UTF-8' }), 'zh-CN');
  assert.equal(locale.detectFromEnv({ LC_MESSAGES: 'zh_CN.UTF-8', LANG: 'en_US.UTF-8' }), 'zh-CN');
  assert.equal(locale.detectFromEnv({ LANG: 'en_US.UTF-8' }), 'en');
  assert.equal(locale.detectFromEnv({}), 'en');
});

test('t interpolates {name} placeholders and leaves missing ones intact', () => {
  locale.setLocale('en');
  assert.equal(
    locale.t('cli.error.unknownArgument', { arg: '--banana' }),
    'Unknown argument: --banana',
  );
  assert.equal(
    locale.t('cli.error.cannotReadManifest', { path: '/tmp/x.json', message: 'boom' }),
    'Cannot read /tmp/x.json: boom',
  );
  // Missing param keeps the placeholder so breakage is visible.
  assert.equal(locale.t('cli.error.unknownArgument'), 'Unknown argument: {arg}');
});

test('setLocale switches the active dictionary', () => {
  locale.setLocale('zh-CN');
  assert.equal(locale.getLocale(), 'zh-CN');
  assert.equal(
    locale.t('cli.error.unknownArgument', { arg: '--banana' }),
    '未知参数：--banana',
  );
  assert.equal(locale.t('cli.usage'), '用法：gsd-omp [install|uninstall|doctor|descriptor] [--root <路径>] [--force] [--json]');
  locale.setLocale('en');
  assert.equal(locale.getLocale(), 'en');
});

test('t falls back to English when a key is absent from the active locale', () => {
  // Temporarily poison the zh-CN dict with a missing key.
  const original = zhCN['cli.usage'];
  delete zhCN['cli.usage'];
  try {
    locale.setLocale('zh-CN');
    assert.equal(locale.t('cli.usage'), en['cli.usage']);
  } finally {
    zhCN['cli.usage'] = original;
  }
});

test('t returns the key itself when unrecognized', () => {
  locale.setLocale('en');
  assert.equal(locale.t('does.not.exist'), 'does.not.exist');
});

test('every English key has a Simplified-Chinese counterpart (parity)', () => {
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zhCN).sort();
  assert.deepEqual(enKeys, zhKeys, 'locale dictionaries must stay in 1:1 key parity');
  for (const key of enKeys) {
    assert.equal(typeof zhCN[key], 'string', `zh-CN.${key} must be a string`);
    assert.ok(zhCN[key].length > 0, `zh-CN.${key} must not be empty`);
    // Same placeholder names, same counts.
  }
});

test('placeholder names match across en and zh-CN for every key', () => {
  const placeholder = /\{(\w+)\}/g;
  for (const key of Object.keys(en)) {
    const enParams = (en[key].match(placeholder) || []).sort();
    const zhParams = (zhCN[key].match(placeholder) || []).sort();
    assert.deepEqual(enParams, zhParams, `placeholder mismatch on key ${key}`);
  }
});

// Restore default locale so downstream tests in the same process are unaffected.
test('restore default locale', () => {
  locale.setLocale('en');
});
