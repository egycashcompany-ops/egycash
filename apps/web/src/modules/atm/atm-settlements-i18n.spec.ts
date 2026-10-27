// Every translation key the settlement pages and papers ask for exists in BOTH catalogs, with the
// same placeholders (docs/12-planning/atm-settlements-phase1.md §9.9, §10.4). A missing key does
// not throw — `translate` falls back to the key — and a placeholder named differently in one
// language renders `{{bag}}` to that reader; `placeholders.spec.ts` only checks for single braces.
//
// The vocabularies are driven from the contracts' own enums (the `atm-register-i18n.spec.ts`
// pattern): a status, an issue code, an outcome or a flag added there without a label here is a
// failing test, in both locales.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATM_LAYOUT_IMPORT_FLAGS,
  ATM_LAYOUT_IMPORT_MODES,
  ATM_LAYOUT_IMPORT_OUTCOMES,
  ATM_LAYOUT_ISSUE_CODES,
  ATM_LAYOUT_ROW_FLAGS,
  ATM_LAYOUT_SOURCES,
  ATM_PLAN_ADD_REFUSALS,
  ATM_PLAN_LINE_ERROR_CODES,
  ATM_PLAN_LINE_STATUSES,
  ATM_PLAN_LINE_WARNING_CODES,
  ATM_PLAN_RUNS,
  ATM_PREPARATION_STATUSES,
  ATM_SLOT_KINDS,
  ATM_STANDARD_LOAD_IMPORT_OUTCOMES,
  type Locale,
} from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { translate } from '../../platform/localization/i18n';

const LOCALES: Locale[] = ['en', 'ar'];

const missingIn = (locale: Locale, keys: readonly string[]): string[] =>
  keys.filter((key) => translate(locale, key) === key);

const VOCABULARIES: { name: string; keys: string[] }[] = [
  { name: 'runs', keys: ATM_PLAN_RUNS.map((n) => `atm.settlement.run.${String(n)}`) },
  { name: 'paper runs', keys: ATM_PLAN_RUNS.map((n) => `atm.paper.run.${String(n)}`) },
  { name: 'line statuses', keys: ATM_PLAN_LINE_STATUSES.map((s) => `atm.settlement.status.${s}`) },
  {
    name: 'plan states',
    keys: ['draft', 'issued', 'partlyIssued'].map((s) => `atm.settlement.planState.${s}`),
  },
  { name: 'slot kinds', keys: ATM_SLOT_KINDS.map((k) => `atm.settlement.slotKind.${k}`) },
  {
    name: 'preparation statuses',
    keys: ATM_PREPARATION_STATUSES.map((s) => `atm.settlement.prep.${s}`),
  },
  { name: 'bags', keys: ['atm.settlement.bag.1', 'atm.settlement.bag.2'] },
  {
    name: 'line issues',
    keys: [...ATM_PLAN_LINE_ERROR_CODES, ...ATM_PLAN_LINE_WARNING_CODES].map(
      (c) => `atm.settlement.issue.${c}`,
    ),
  },
  { name: 'add refusals', keys: ATM_PLAN_ADD_REFUSALS.map((r) => `atm.plan.refused.${r}`) },
  { name: 'layout row flags', keys: ATM_LAYOUT_ROW_FLAGS.map((f) => `atm.layouts.flag.${f}`) },
  {
    name: 'layout issues',
    keys: ATM_LAYOUT_ISSUE_CODES.map((c) => `atm.layouts.layoutIssue.${c}`),
  },
  { name: 'layout sources', keys: ATM_LAYOUT_SOURCES.map((s) => `atm.layouts.source.${s}`) },
  {
    name: 'import outcomes',
    keys: ATM_LAYOUT_IMPORT_OUTCOMES.map((o) => `atm.layoutImport.outcome.${o}`),
  },
  { name: 'import flags', keys: ATM_LAYOUT_IMPORT_FLAGS.map((f) => `atm.layoutImport.flag.${f}`) },
  { name: 'import modes', keys: ATM_LAYOUT_IMPORT_MODES.map((m) => `atm.layoutImport.mode.${m}`) },
  {
    name: 'standard-load outcomes',
    keys: ATM_STANDARD_LOAD_IMPORT_OUTCOMES.map((o) => `atm.layoutImport.standardOutcome.${o}`),
  },
  {
    name: 'navigation and cards',
    keys: ['settlementPlan', 'cassetteLayouts', 'preparation', 'control'].flatMap((p) => [
      `atm.nav.${p}`,
      `atm.cards.${p}`,
    ]),
  },
  {
    name: 'audit verbs',
    keys: ['atmLayoutImport', 'atmSettlementPrint'].map((a) => `systemAdmin.users.audit.${a}`),
  },
];

/** Every key of the settlement namespaces, read from the dictionary source. */
const SETTLEMENT_KEYS = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(here, '../../platform/localization/i18n.ts'), 'utf8');
  const keys = new Set<string>();
  const re =
    /^\s*'(atm\.(?:settlement|plan|layouts|layoutImport|prep|control|paper)\.[^']+|atm\.(?:nav|cards)\.(?:settlementPlan|cassetteLayouts|preparation|control))':/gmu;
  for (const match of source.matchAll(re)) if (match[1] !== undefined) keys.add(match[1]);
  return [...keys];
})();

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{\{(\w+)\}\}/gu)].map((m) => m[1] ?? '').sort();

describe('the settlement pages’ and papers’ translations', () => {
  it('reads the dictionary at all — a scan over nothing passes forever', () => {
    expect(SETTLEMENT_KEYS.length).toBeGreaterThan(300);
  });

  for (const { name, keys } of VOCABULARIES) {
    it.each(LOCALES)(`every ${name} label resolves in %s`, (locale) => {
      expect(missingIn(locale, keys)).toEqual([]);
    });
  }

  it.each(LOCALES)('every settlement key exists in %s', (locale) => {
    expect(missingIn(locale, SETTLEMENT_KEYS)).toEqual([]);
  });

  it('every settlement key has the same placeholder names in both languages', () => {
    const differing = SETTLEMENT_KEYS.filter(
      (key) =>
        placeholders(translate('en', key)).join() !== placeholders(translate('ar', key)).join(),
    );
    expect(differing).toEqual([]);
  });

  it('keeps no subtitle — a page header carries a title only (owner rule)', () => {
    for (const locale of LOCALES) {
      for (const key of [
        'atm.plan.subtitle',
        'atm.layouts.subtitle',
        'atm.layoutImport.subtitle',
        'atm.prep.subtitle',
        'atm.control.subtitle',
      ]) {
        expect(translate(locale, key), `${locale} ${key}`).toBe(key);
      }
    }
  });

  it('says one word per concept on the screens and the paper’s own word on the paper (DS-32)', () => {
    expect(translate('ar', 'atm.settlement.slot', { slot: 3 })).toBe('كاسيت 3');
    expect(translate('ar', 'atm.settlement.bag.1')).toBe('الشوال الأول');
    expect(translate('ar', 'atm.prep.sealLabel', { slot: 3 })).toBe('سيلز الكاسيت 3');
    expect(translate('ar', 'atm.paper.bag')).toBe('الحقيبة');
    // The bag-slots line uses the same `{{bag}}` in both languages (UI-31).
    expect(
      translate('ar', 'atm.settlement.bag.slots', { bag: 'الشوال الأول', from: 1, to: 4 }),
    ).toBe('الشوال الأول — الكاسيتات 1 إلى 4');
  });
});

describe('the five settlement pages’ headers', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const PAGES = [
    'SettlementPlanPage',
    'CassetteLayoutsPage',
    'LayoutImportPage',
    'PreparationPage',
    'ControlPage',
  ];

  it.each(PAGES)('%s passes PageHeader a title and no subtitle (owner rule)', (page) => {
    const source = readFileSync(resolve(here, `./pages/${page}.tsx`), 'utf8');
    const headers = [...source.matchAll(/<PageHeader\b[^>]*?(?:\/>|>)/gs)].map((m) => m[0]);
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header).toMatch(/title=\{t\('atm\.[a-zA-Z]+\.title'\)\}/);
      expect(header).not.toMatch(/description|subtitle/);
    }
    expect(source).not.toMatch(/\.subtitle'/);
  });
});
