// Every translation key the efficiency register's screens ask for exists in BOTH catalogs (spec
// §9). A missing key does not throw — `translate` falls back to the key — so without this an
// Arabic reader would see `atm.register.issue.hdbSpelling` on screen.
//
// The vocabularies are driven from the contracts' own enums rather than a hand-written list: a
// status, an issue code, a warning, a blocker or an error code added there without a label here is
// a failing test, in both locales. The page-level strings are listed literally, because nothing
// else enumerates them.
import { describe, expect, it } from 'vitest';
import {
  ATM_REGISTER_BRANCH_CODES,
  ATM_REGISTER_COLUMNS,
  ATM_REGISTER_GROUPS,
  ATM_REGISTER_IMPORT_BLOCKERS,
  ATM_REGISTER_IMPORT_CATEGORIES,
  ATM_REGISTER_IMPORT_ISSUES,
  ATM_REGISTER_IMPORT_OUTCOMES,
  ATM_REGISTER_IMPORT_REASONS,
  ATM_REGISTER_IMPORT_REPORTS,
  ATM_REGISTER_IMPORT_RUN_STATES,
  ATM_REGISTER_MASTER_ACTIONS,
  ATM_REGISTER_MASTER_STATES,
  ATM_REGISTER_STATUSES,
  ATM_REGISTER_WARNINGS,
  ErrorCodes,
  type Locale,
} from '@ecms/contracts';
import { translate } from '../../platform/localization/i18n';
import {
  bankName,
  branchLabel,
  columnHeaderKey,
  formatAsOf,
  formatRegisterDate,
  statusLabelKey,
} from './lib/register-labels';

const LOCALES: Locale[] = ['en', 'ar'];

const missingIn = (locale: Locale, keys: readonly string[]): string[] =>
  keys.filter((key) => translate(locale, key) === key);

/** The new error codes of the register (spec §3.10) — one label each. */
const REGISTER_ERROR_CODES = Object.values(ErrorCodes).filter((code) =>
  code.startsWith('ATM_REGISTER_'),
);

const PAGE_KEYS = [
  // Navigation, cards, data-edit (§9.1).
  'atm.nav.register',
  'atm.nav.registerReport',
  'atm.cards.register',
  'atm.cards.registerReport',
  'atm.dataEdit.moveArea',
  'atm.dataEdit.moveAreaTitle',
  'atm.dataEdit.moveAreaHint',
  'atm.dataEdit.areaMoved',
  'systemAdmin.users.audit.secretRevealed',
  'systemAdmin.users.audit.atmRegisterImport',
  // Register page (§9.2).
  'atm.register.title',
  'atm.register.receive',
  'atm.register.export',
  'atm.register.import',
  'atm.register.openReport',
  'atm.register.noMapping',
  'atm.register.empty',
  'atm.register.filter.branch',
  'atm.register.filter.allBranches',
  'atm.register.filter.bank',
  'atm.register.filter.allBanks',
  'atm.register.filter.status',
  'atm.register.filter.allStatuses',
  'atm.register.filter.area',
  'atm.register.filter.allAreas',
  'atm.register.filter.search',
  'atm.register.filter.withIssues',
  'atm.register.secretHidden',
  'atm.register.combinationSet',
  'atm.register.combinationUnset',
  'atm.register.issues',
  'atm.register.actions',
  'atm.register.action.edit',
  'atm.register.action.receivePending',
  'atm.register.action.handover',
  'atm.register.action.reveal',
  'atm.register.action.delete',
  'atm.register.action.link',
  'atm.register.received',
  'atm.register.saved',
  'atm.register.handedOver',
  'atm.register.deleted',
  'atm.register.form.receiveTitle',
  'atm.register.form.editTitle',
  'atm.register.form.receivePendingTitle',
  'atm.register.form.handoverTitle',
  'atm.register.form.handoverHint',
  'atm.register.form.deleteTitle',
  'atm.register.form.deleteBody',
  'atm.register.form.linkTitle',
  'atm.register.form.linkBody',
  'atm.register.form.linkOnAreaHint',
  'atm.register.form.opsBankLabel',
  'atm.register.form.opsBankLabelAuto',
  'atm.register.form.startDateHint',
  'atm.register.form.areaRequired',
  'atm.register.form.combinationKeep',
  'atm.register.form.combinationClear',
  'atm.register.form.codeLocked',
  'atm.register.reveal.title',
  'atm.register.reveal.body',
  'atm.register.reveal.confirm',
  'atm.register.reveal.hidesIn',
  'atm.register.reveal.copy',
  'atm.register.reveal.none',
  // Data Report (§9.3).
  'atm.registerReport.title',
  'atm.registerReport.asOf',
  'atm.registerReport.section1',
  'atm.registerReport.section2',
  'atm.registerReport.section3',
  'atm.registerReport.total',
  'atm.registerReport.legend',
  'atm.registerReport.empty',
  'atm.registerReport.unmapped',
  'atm.registerReport.withoutBank',
  'atm.registerReport.chartSummary',
  // Import page and settings card (§9.4).
  'atm.registerImport.title',
  'atm.registerImport.intro',
  'atm.registerImport.upload',
  'atm.registerImport.preview',
  'atm.registerImport.apply',
  'atm.registerImport.applyConfirmTitle',
  'atm.registerImport.applyConfirmBody',
  'atm.registerImport.applied',
  'atm.registerImport.counts.rows',
  'atm.registerImport.counts.open',
  'atm.registerImport.counts.ended',
  'atm.registerImport.counts.pending',
  'atm.registerImport.counts.alreadyImported',
  'atm.registerImport.reportCheck.title',
  'atm.registerImport.reportCheck.section',
  'atm.registerImport.reportCheck.label',
  'atm.registerImport.reportCheck.cell',
  'atm.registerImport.reportCheck.expected',
  'atm.registerImport.reportCheck.recomputed',
  'atm.registerImport.reportCheck.match',
  'atm.registerImport.reportCheck.mismatch',
  'atm.registerImport.reportCheck.allMatch',
  'atm.registerImport.reportOverride',
  'atm.registerImport.reportOverrideHint',
  'atm.registerImport.approve',
  'atm.registerImport.issues.title',
  'atm.registerImport.issues.row',
  'atm.registerImport.issues.codes',
  'atm.registerImport.issues.column',
  'atm.registerImport.branches.title',
  'atm.registerImport.branches.code',
  'atm.registerImport.branches.branch',
  'atm.registerImport.branches.active',
  'atm.registerImport.branches.inReach',
  'atm.registerImport.branches.rows',
  'atm.registerImport.branches.openRows',
  'atm.registerImport.runs.title',
  'atm.registerImport.runs.started',
  'atm.registerImport.runs.finished',
  'atm.registerImport.runs.state',
  'atm.registerImport.runs.actor',
  'atm.registerImport.runs.categories',
  'atm.registerImport.runs.counts',
  'atm.registerImport.runs.empty',
  'atm.registerImport.item.row',
  'atm.registerImport.item.reason',
  'atm.registerImport.item.differences',
  'atm.registerImport.item.otherBranch',
  'atm.registerImport.item.columns',
  'atm.registerImport.pairs.from',
  'atm.registerImport.pairs.to',
  'atm.registerImport.pairs.count',
  'atm.registerSettings.title',
  'atm.registerSettings.branchCodes',
  'atm.registerSettings.code',
  'atm.registerSettings.sheetName',
  'atm.registerSettings.branch',
  'atm.registerSettings.pickBranch',
  'atm.registerSettings.bankLabels',
  'atm.registerSettings.bank',
  'atm.registerSettings.bankName',
  'atm.registerSettings.label',
  'atm.registerSettings.save',
  'atm.registerSettings.saved',
  'atm.registerSettings.readOnly',
];

/** The vocabularies, each a prefix over a contracts enum. */
const VOCABULARIES: { name: string; keys: string[] }[] = [
  { name: 'columns', keys: ATM_REGISTER_COLUMNS.map((c) => columnHeaderKey(c.field)) },
  { name: 'column groups', keys: ATM_REGISTER_GROUPS.map((g) => `atm.register.group.${g}`) },
  { name: 'statuses', keys: ATM_REGISTER_STATUSES.map(statusLabelKey) },
  { name: 'import issues', keys: ATM_REGISTER_IMPORT_ISSUES.map((c) => `atm.register.issue.${c}`) },
  { name: 'warnings', keys: ATM_REGISTER_WARNINGS.map((c) => `atm.register.warning.${c}`) },
  { name: 'error codes', keys: REGISTER_ERROR_CODES.map((c) => `atm.register.error.${c}`) },
  {
    name: 'master states',
    keys: ATM_REGISTER_MASTER_STATES.map((s) => `atm.register.master.${s}`),
  },
  {
    // `none` is the absence of an Operations change — nothing is announced for it.
    name: 'master actions',
    keys: ATM_REGISTER_MASTER_ACTIONS.filter((a) => a !== 'none').map(
      (a) => `atm.register.masterAction.${a}`,
    ),
  },
  {
    name: 'import categories and report categories',
    keys: [...ATM_REGISTER_IMPORT_CATEGORIES, ...ATM_REGISTER_IMPORT_REPORTS].flatMap((key) => [
      `atm.registerImport.category.${key}.title`,
      `atm.registerImport.category.${key}.body`,
    ]),
  },
  {
    name: 'import reasons',
    keys: ATM_REGISTER_IMPORT_REASONS.map((r) => `atm.registerImport.reason.${r}`),
  },
  {
    name: 'import blockers',
    keys: ATM_REGISTER_IMPORT_BLOCKERS.map((b) => `atm.registerImport.blocker.${b}`),
  },
  {
    name: 'blocker hints',
    keys: ['dateUnreadable', 'openInRegister', 'changedSinceImport', 'secretsOutOfReach'].map(
      (b) => `atm.registerImport.blockerHint.${b}`,
    ),
  },
  {
    name: 'import outcomes',
    keys: ATM_REGISTER_IMPORT_OUTCOMES.map((o) => `atm.registerImport.outcome.${o}`),
  },
  {
    name: 'import run states',
    keys: ATM_REGISTER_IMPORT_RUN_STATES.map((s) => `atm.registerImport.runs.state.${s}`),
  },
  {
    name: 'report branch labels',
    keys: ATM_REGISTER_BRANCH_CODES.flatMap((code) => [
      `atm.registerReport.branch2.${code}`,
      `atm.registerReport.branch3.${code}`,
    ]),
  },
];

describe('the efficiency register i18n catalog', () => {
  it('counts what it checks — the vocabularies are the sizes the spec names', () => {
    const size = (name: string): number =>
      VOCABULARIES.find((v) => v.name === name)?.keys.length ?? 0;
    expect(size('columns')).toBe(49);
    expect(size('import issues')).toBe(26);
    expect(size('warnings')).toBe(7);
    expect(size('error codes')).toBe(14);
    expect(size('report branch labels')).toBe(14);
  });

  it.each(LOCALES)('every page key resolves in %s', (locale) => {
    expect(missingIn(locale, PAGE_KEYS)).toEqual([]);
  });

  for (const { name, keys } of VOCABULARIES) {
    it.each(LOCALES)(`every ${name} label resolves in %s`, (locale) => {
      expect(missingIn(locale, keys)).toEqual([]);
    });
  }

  it('keeps no subtitle — a page header carries a title only (owner rule)', () => {
    for (const locale of LOCALES) {
      for (const key of [
        'atm.register.subtitle',
        'atm.registerReport.subtitle',
        'atm.registerImport.subtitle',
      ]) {
        expect(translate(locale, key), `${locale} ${key}`).toBe(key);
      }
    }
  });

  it('writes the Data Report labels as the sheet does, with the D7 fixes', () => {
    expect(translate('ar', 'atm.registerReport.branch2.EGYCASH-4')).toBe('فرع إيجي كاش الإسكندرية');
    expect(translate('ar', 'atm.registerReport.branch2.EGYCASH-6')).toBe('فرع إيجي كاش بور سعيد');
    // DEC-28 — provisional, owner to confirm (EG-21).
    expect(translate('ar', 'atm.registerReport.total')).toBe('إجمالي عدد الماكينات');
    expect(bankName('NXT', 'ar')).toBe('NXT BANK');
  });

  it('keeps the untranslated headers untranslated (DEC-22)', () => {
    for (const locale of LOCALES) {
      expect(translate(locale, 'atm.register.col.keys.alanki')).toBe('Alanki');
      expect(translate(locale, 'atm.register.col.hub')).toBe('HUB');
      expect(translate(locale, 'atm.register.col.cassettes.recycle200')).toBe('200');
    }
  });
});

describe('register-labels', () => {
  it('names banks and branches from the contracts', () => {
    expect(bankName('BM', 'ar')).toBe('بنك مصر');
    expect(bankName('BM', 'en')).toBe('Banque Misr');
    expect(branchLabel('EGYCASH-7', 'ar')).toBe('وصال');
    expect(branchLabel('EGYCASH-1', 'en')).toBe('Mohandessin');
  });

  it('reads a register date as a calendar day, never shifted', () => {
    expect(formatRegisterDate('2026-01-12')).toBe('12/01/2026');
    expect(formatRegisterDate(null)).toBe('—');
  });

  it('stamps the as-of day on the Cairo calendar, dd / MMMM / yyyy', () => {
    // 23:30 UTC on 12 January is already 13 January in Cairo.
    expect(formatAsOf('2026-01-12T23:30:00.000Z', 'en')).toBe('13 / January / 2026');
    expect(formatAsOf('2026-01-12T10:00:00.000Z', 'en')).toBe('12 / January / 2026');
    expect(formatAsOf('not a date', 'en')).toBe('—');
  });
});
