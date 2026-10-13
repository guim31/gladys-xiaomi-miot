// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names and the documentation. German says "du", never the
// polite "Sie"; Spanish says "usted".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { KIND_NAMES, NAMES, VALUE_LABELS } from '../src/miot/names.js';
import { ACTION_TEXT, CONNECTION_TEXT, INIT_FAILED, localized, thrown } from '../src/texts.js';
import { TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 600,
  short: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

/** Tables written one language at a time: same keys everywhere, no empty text. */
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

test('the configuration offers the four languages, French by default', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  const field = manifest.config_schema.find((entry) => entry.key === 'language');
  assert.equal(field.default, 'fr');
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 60, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the same in every language, the description 10 to 100 characters', () => {
  assert.equal(typeof manifest.name, 'string');
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('the feature names, device kinds and value labels exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
  assert.deepEqual(tableProblems(KIND_NAMES, 'KIND_NAMES', MAX.featureName), []);
  assert.deepEqual(tableProblems(VALUE_LABELS, 'VALUE_LABELS', 24), []);
});

test('every message of the code has the four languages', () => {
  const found = [
    ...problems(INIT_FAILED, 'INIT_FAILED', MAX.message),
    ...Object.entries(CONNECTION_TEXT).flatMap(([key, value]) =>
      problems(value, `CONNECTION_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(TEXT).flatMap(([key, value]) =>
      problems(
        value,
        `TEXT.${key}`,
        ['pick', 'unknown', 'noSpec'].includes(key) ? MAX.message : MAX.short,
      ),
    ),
  ];
  assert.deepEqual(found, []);
});

test('the action messages exist in every language, with their values', () => {
  const samples = {
    verification: ['https://account.xiaomi.com/fe/service/identity/authStart?context=x'],
    unreachable: ['Cannot reach account.xiaomi.com (ECONNREFUSED)'],
    refused: ['code 70002'],
    imported: [2, ['Purifier', 'Plug']],
    noneImported: ['de'],
    leftOut: [1, 2, 3],
    noAnswerAt: ['192.0.2.10'],
    wrongToken: ['192.0.2.10'],
    vacuum: ['roborock.vacuum.a15'],
    added: ['zhimi.airp.mb5', '192.0.2.10'],
    noSpec: ['acme.plug.x1'],
    forgotten: ['Purifier'],
    features: [12],
    ignored: [['6 alarm', '9 custom-service']],
    unknownOnNetwork: [['192.0.2.20']],
  };
  const render = (value, key) =>
    typeof value === 'function' ? value(...(samples[key] ?? [])) : value;
  const found = [];
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(ACTION_TEXT[lang])) {
      found.push(
        ...textProblems(render(value, key), `ACTION_TEXT.${lang}.${key}`, lang, MAX.message),
      );
    }
  }
  assert.deepEqual(
    tableProblems(ACTION_TEXT, 'ACTION_TEXT', MAX.message, (value) =>
      typeof value === 'function' ? 'f' : value,
    ),
    [],
  );
  assert.deepEqual(found, []);
  const message = localized((text) => text.leftOut(1, 2, 3));
  assert.match(message.de, /1 Saugroboter/);
  assert.match(message.es, /2 dispositivo\(s\) Bluetooth o Zigbee/);
  assert.equal(thrown({ en: 'a', fr: 'b', de: 'c', es: 'd' }), 'a / b / c / d');
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Light', fr: 'Lumière', de: 'Licht' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Light', fr: 'Lumière', de: '', es: 'Luz' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of [
    'Wählen Sie',
    'Ihr Gerät',
    'Ihre IP',
    'mit Ihrem',
    'Ihren',
    'Ihrer',
    'Ihres',
  ]) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[0].fields[1].placeholder.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_actions[0].fields[1].placeholder has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

const headings = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four documentation files exist, with the same sections', () => {
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 300, `docs/${lang}.md is too short for the store`);
    assert.deepEqual(headings(docs[lang]), headings(docs.en), `docs/${lang}.md sections`);
  }
  assert.ok(headings(docs.en).length >= 12);
});

test('the guard catches documentation sections that differ', () => {
  const missing = docs.fr.replace(/\n## Limites[\s\S]*$/, '\n');
  assert.notDeepEqual(headings(missing), headings(docs.en));
});

test('the documentation names every feature, trigger, action, widget and button', () => {
  for (const lang of LANGS) {
    // Prettier wraps the paragraphs: compare on single spaces.
    const doc = docs[lang].replace(/\s+/g, ' ');
    for (const item of [
      ...manifest.scene_triggers,
      ...manifest.scene_actions,
      ...manifest.actions,
      ...manifest.widgets,
    ]) {
      assert.ok(doc.includes(item.label[lang]), `docs/${lang}.md: "${item.label[lang]}"`);
    }
    for (const name of Object.values(NAMES[lang])) {
      assert.ok(doc.includes(name), `docs/${lang}.md: feature "${name}"`);
    }
    for (const key of ['turnOn', 'turnOff']) {
      assert.ok(doc.includes(TEXT[key][lang]), `docs/${lang}.md: "${TEXT[key][lang]}"`);
    }
    for (const option of manifest.scene_triggers[0].fields[1].options) {
      assert.ok(doc.includes(option.label[lang]), `docs/${lang}.md: "${option.label[lang]}"`);
    }
    for (const key of ['username', 'password', 'region', 'poll_interval', 'language']) {
      const field = manifest.config_schema.find((entry) => entry.key === key);
      assert.ok(doc.includes(field.label[lang]), `docs/${lang}.md: "${field.label[lang]}"`);
    }
  }
});

test('the German documentation says "du"', () => {
  const polite = docs.de
    .split('\n')
    .filter((line) => !line.startsWith('`') && POLITE_GERMAN.test(line));
  assert.deepEqual(polite, []);
});

test('the documentation says it was developed without the hardware, and not affiliated', () => {
  for (const lang of LANGS) {
    assert.match(docs[lang], /Developed without the hardware: feedback welcome/);
    assert.match(docs[lang], /github\.com\/guim31\/gladys-xiaomi-miot\/issues/);
    assert.match(docs[lang], /Xiaomi Home/, 'the vacuums integration is named');
  }
  assert.match(docs.en, /Not affiliated with Xiaomi/);
});
