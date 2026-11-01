// The settlement pages' shared view rules (docs/12-planning/atm-settlements-phase1.md §9.3, §10.4).
import {
  ATM_PLAN_LINE_ERROR_CODES,
  ATM_PLAN_LINE_WARNING_CODES,
  ErrorCodes,
  type AtmPlanSlot,
} from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { translate } from '../../../platform/localization/i18n';
import { ApiError } from '../../../shared/lib/api-client';
import {
  bagSlotsText,
  bagsText,
  blockedOf,
  currentVersion,
  denominationMinor,
  formatEgp,
  isStale,
  issueText,
  lastImportFigures,
  lineBags,
  lineChips,
  lineCode,
  lineStatusKey,
  missingFieldLabel,
  offersLayoutRefresh,
  planState,
  prepStateOf,
  preparationStatusKey,
  runLabel,
  settlementErrorText,
  settlementErrorToast,
  TOAST_TITLE_MAX,
  toastWords,
} from './settlement-view';

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const en = (key: string, params?: Record<string, string | number>): string =>
  translate('en', key, params);

const byStatus = (draft: number, issued: number, prepared: number, cancelled = 0) => ({
  byStatus: { draft, issued, prepared, cancelled },
});

const slot = (
  n: number,
  kind: AtmPlanSlot['kind'],
  denomination: number | null,
  notes: number,
  currency: string | null = 'EGP',
): AtmPlanSlot => ({ slot: n, kind, denomination, currency, notes, bag: null });

describe('planState', () => {
  it('no line issued → draft; every live line issued or prepared → issued; drafts left → partly', () => {
    expect(planState(byStatus(0, 0, 0))).toBe('draft');
    expect(planState(byStatus(3, 0, 0, 2))).toBe('draft');
    expect(planState(byStatus(0, 2, 1, 1))).toBe('issued');
    expect(planState(byStatus(0, 0, 4))).toBe('issued');
    expect(planState(byStatus(1, 2, 0))).toBe('partlyIssued');
  });
});

describe('lineChips', () => {
  it('one chip per planned slot, in slot order, coloured per denomination', () => {
    const chips = lineChips([
      slot(3, 'withdrawal', 50, 1500),
      slot(1, 'empty', null, 0, null),
      slot(2, 'withdrawal', 200, 4000),
      slot(4, 'deposit', null, 0),
      slot(5, 'recycle', 100, 2000),
      slot(6, 'withdrawal', 20, 0, 'USD'),
    ]);
    expect(chips.map((c) => [c.slot, c.denomination, c.notes])).toEqual([
      [2, 200, 4000],
      [3, 50, 1500],
      [5, 100, 2000],
    ]);
    expect(chips[0]).toMatchObject({ background: '#e0e7ff', colour: '#3730a3' });
    expect(chips[2]).toMatchObject({ background: '#d1fae5', colour: '#065f46' });
  });
});

describe('the words', () => {
  it('bagsText: one bag or two', () => {
    expect(bagsText(1, ar)).toBe('شوال واحد');
    expect(bagsText(2, ar)).toBe('شوالان (٤ كاسيتات في الشوال)');
    expect(bagsText(2, en)).toBe('Two bags (4 cassettes per bag)');
  });

  it('issueText words every issue code, in both languages, a slot issue naming its cassette', () => {
    for (const code of [...ATM_PLAN_LINE_ERROR_CODES, ...ATM_PLAN_LINE_WARNING_CODES]) {
      for (const t of [ar, en]) {
        const text = issueText({ code, severity: 'warning', slot: 3 }, t);
        expect(text, code).not.toBe(`atm.settlement.issue.${code}`);
        expect(text, code).not.toMatch(/\{\{/u);
      }
    }
    expect(issueText({ code: 'NOT_MULTIPLE_OF_100', severity: 'warning', slot: 3 }, ar)).toBe(
      'عدد الورق في الكاسيت 3 ليس من مضاعفات 100.',
    );
    expect(issueText({ code: 'NO_LAYOUT', severity: 'error' }, ar)).toBe(
      'لم تُسجَّل فئات الكاسيتات لهذه الماكينة.',
    );
  });

  it('runs and statuses have their words', () => {
    expect(runLabel(1, ar)).toBe('التغذية الأولى');
    expect(runLabel(3, en)).toBe('3rd run');
    expect(ar(lineStatusKey('prepared'))).toBe('جاهزة');
    expect(en(lineStatusKey('issued'))).toBe('Issued');
    expect(ar(preparationStatusKey('partial'))).toBe('ناقصة');
  });
});

const apiError = (
  code: string,
  details: { field?: string; code: string; message: string }[] = [],
  status = 409,
): ApiError => new ApiError(code, 'server sentence', status, details);

describe('a line’s code and bags', () => {
  it('lineCode: the machine, else the spare, else «—»', () => {
    expect(lineCode({ machineCode: '1001', spareCode: null })).toBe('1001');
    expect(lineCode({ machineCode: null, spareCode: 'SP1' })).toBe('SP1');
    expect(lineCode({ machineCode: null, spareCode: null })).toBe('—');
  });

  it('lineBags: a draft is cut as the issue will cut it; an issued line keeps its own bags', () => {
    const draft = [1, 2, 3, 4, 5, 6].map((n) => slot(n, 'withdrawal', 100, 1000));
    expect(lineBags(draft)).toEqual([
      { bag: 1, slots: [1, 2, 3, 4] },
      { bag: 2, slots: [5, 6] },
    ]);
    const issued = draft.map((s, i) => ({ ...s, bag: (i < 4 ? 1 : 2) as 1 | 2 }));
    expect(lineBags(issued)).toEqual([
      { bag: 1, slots: [1, 2, 3, 4] },
      { bag: 2, slots: [5, 6] },
    ]);
    expect(lineBags([slot(1, 'empty', null, 0, null), slot(2, 'withdrawal', 200, 10)])).toEqual([
      { bag: 1, slots: [2] },
    ]);
  });
});

describe('money on the screens (DS-28)', () => {
  it('converts minor units once', () => {
    expect(formatEgp(80_000_000, 'en')).toContain('800,000');
    expect(denominationMinor(200, 4000)).toBe(80_000_000);
  });
});

describe('a blocked work branch', () => {
  it('reads S1’s two reasons off a 422 ATM_WORK_BRANCH_REQUIRED', () => {
    const choose = apiError(ErrorCodes.ATM_WORK_BRANCH_REQUIRED, [
      { field: 'branch', code: 'CHOOSE_BRANCH', message: 'CHOOSE_BRANCH' },
    ]);
    const none = apiError(ErrorCodes.ATM_WORK_BRANCH_REQUIRED, [
      { field: 'branch', code: 'NO_BRANCH', message: 'NO_BRANCH' },
    ]);
    expect(blockedOf(choose)).toBe('chooseBranch');
    expect(blockedOf(none)).toBe('noBranch');
    expect(blockedOf(apiError(ErrorCodes.STALE_DOCUMENT))).toBeNull();
    expect(blockedOf(null)).toBeNull();
  });
});

describe('settlementErrorText', () => {
  const text = (error: unknown): string => settlementErrorText(error, ar, 'ar');

  it('words every named code of §6.1 the pages meet', () => {
    expect(text(apiError(ErrorCodes.ATM_PLAN_EXISTS))).toBe(ar('atm.plan.error.exists'));
    expect(text(apiError(ErrorCodes.ATM_PLAN_FULL))).toBe(ar('atm.plan.error.full'));
    expect(text(apiError(ErrorCodes.ATM_PLAN_LINE_STATE))).toBe(ar('atm.plan.error.lineState'));
    expect(text(apiError(ErrorCodes.ATM_PLAN_LINE_HAS_CAPTURES))).toBe(
      ar('atm.plan.error.hasCaptures'),
    );
    expect(text(apiError(ErrorCodes.ATM_LAYOUT_IMPORT_FILE_CHANGED))).toBe(
      ar('atm.layoutImport.error.fileChanged'),
    );
    expect(text(apiError(ErrorCodes.ATM_LAYOUT_IMPORT_RUNNING))).toBe(
      ar('atm.layoutImport.error.running'),
    );
    expect(text(apiError(ErrorCodes.ATM_PREPARATION_LOCKED))).toBe(ar('atm.prep.error.locked'));
  });

  it('a draft moved onto a run its machine already has reads as the add dialog does (FIT-2)', () => {
    expect(
      text(
        apiError(ErrorCodes.BUSINESS_RULE_VIOLATION, [
          { field: 'body.run', code: 'DUPLICATE_IN_RUN', message: 'DUPLICATE_IN_RUN' },
        ]),
      ),
    ).toBe(ar('atm.plan.refused.duplicateInRun'));
  });

  it('names what a refusal carried: the counts in use, the missing fields, the headers', () => {
    expect(
      text(
        apiError(ErrorCodes.ATM_STANDARD_LOAD_IN_USE, [
          { field: 'layouts', code: 'IN_USE', message: '3' },
          { field: 'draftLines', code: 'IN_USE', message: '2' },
        ]),
      ),
    ).toBe(ar('atm.layouts.error.inUse', { layouts: '٣', draftLines: '٢' }));
    expect(
      text(
        apiError(ErrorCodes.ATM_PREPARATION_INCOMPLETE, [
          { field: 'bags[0].qr', code: 'REQUIRED', message: 'REQUIRED' },
          { field: 'seals[slot=3]', code: 'REQUIRED', message: 'REQUIRED' },
        ]),
      ),
    ).toBe(ar('atm.prep.error.incomplete', { list: 'QR الشوال الأول، سيلز الكاسيت 3' }));
    expect(
      text(
        apiError(ErrorCodes.ATM_LAYOUT_IMPORT_LAYOUT, [
          { field: 'Full list', code: 'MISSING_HEADER', message: 'Denom1' },
        ]),
      ),
    ).toBe(ar('atm.layoutImport.error.layout', { names: 'Denom1' }));
    expect(
      text(
        apiError(ErrorCodes.ATM_LAYOUT_IMPORT_LAYOUT, [
          { field: 'file', code: 'TOO_LARGE', message: 'entries' },
        ]),
      ),
    ).toBe(ar('atm.layoutImport.error.tooLarge'));
  });

  it('words the field codes, and leaves everything else to the shared wording', () => {
    const field = (code: string): ApiError =>
      apiError('VALIDATION_FAILED', [{ field: 'x', code, message: code }], 400);
    expect(text(field('SLOT_NOT_FILLABLE'))).toBe(ar('atm.plan.error.slotNotFillable'));
    // A typed total whose even split overfills a cassette (MONEY-1).
    expect(text(field('CASSETTE_NOTES_MAX'))).toBe(
      ar('atm.plan.error.cassetteNotesMax', { max: '١٠٠٬٠٠٠' }),
    );
    expect(text(field('INVALID_SEAL'))).toBe(ar('atm.prep.error.invalidSeal'));
    expect(text(field('DUPLICATE_NAME'))).toBe(ar('atm.control.error.duplicateName'));
    const moved = apiError(ErrorCodes.STALE_DOCUMENT, [
      { field: 'moves[0]', code: 'MOVED', message: 'MOVED' },
    ]);
    expect(text(moved)).toBe(ar('atm.control.error.moved'));
    expect(isStale(moved)).toBe(true);
    expect(text(apiError(ErrorCodes.STALE_DOCUMENT))).not.toBe('server sentence');
  });

  it('missingFieldLabel reads the server’s field names', () => {
    expect(missingFieldLabel('bags[1].qr', ar)).toBe('QR الشوال الثاني');
    expect(missingFieldLabel('seals[slot=5]', ar)).toBe('سيلز الكاسيت 5');
  });
});

describe('the last import’s strip', () => {
  it('counts rows, matches, the missing and what needs a person, from outcome counts only', () => {
    expect(
      lastImportFigures({
        new: 5,
        same: 50,
        changed: 2,
        changedManual: 1,
        notFound: 40,
        archived: 4,
        noRegisterBank: 3,
        otherBank: 1,
        duplicateInFile: 0,
        invalid: 2,
        created: 5,
        updated: 2,
        conflicts: 0,
      }),
    ).toEqual({ rows: 108, matched: 66, notFound: 40, review: 11 });
  });
});

describe('a Preparation row’s state', () => {
  const prep = (
    over: Partial<{ status: 'open' | 'prepared'; qr: string | null; seal: string | null }>,
  ) => ({
    lineStatus: 'issued' as const,
    preparation: {
      status: over.status ?? ('open' as const),
      bags: [{ qr: over.qr ?? null }],
      seals: [{ value: over.seal ?? null }],
    },
    progress: { captured: (over.qr ? 1 : 0) + (over.seal ? 1 : 0), required: 2 },
  });

  it('none → partial → complete → prepared, and cancelled says so', () => {
    expect(prepStateOf(prep({}))).toBe('none');
    expect(prepStateOf(prep({ seal: 'S1' }))).toBe('partial');
    expect(prepStateOf(prep({ seal: 'S1', qr: 'Q1' }))).toBe('complete');
    expect(prepStateOf(prep({ status: 'prepared', seal: 'S1', qr: 'Q1' }))).toBe('prepared');
    expect(prepStateOf({ ...prep({}), lineStatus: 'cancelled' })).toBe('cancelled');
  });
});

describe('currentVersion — a dialog retries with the re-read version (LIVE-2)', () => {
  const snapshot = { id: 'line-1', version: 1, name: 'opened with' };
  it('takes the version from the query data, not the snapshot the dialog kept', () => {
    // A Control move bumped the line while the dialog was open; the 409 made the page re-read.
    const reread = [
      { id: 'line-0', version: 7, name: 'other' },
      { id: 'line-1', version: 2, name: 'opened with' },
    ];
    expect(currentVersion(reread, snapshot)).toBe(2);
  });
  it('falls back to the snapshot when the record is not in the data', () => {
    expect(currentVersion([], snapshot)).toBe(1);
    expect(currentVersion(undefined, snapshot)).toBe(1);
  });
});

describe('a bag’s heading (LIVE-8)', () => {
  const t = (key: string, params?: Record<string, string | number>): string =>
    translate('ar', key, params);
  it('names its cassettes «من … إلى …» in the UI’s digits', () => {
    expect(bagSlotsText(1, [1, 2, 3, 4], t, 'ar')).toBe('الشوال الأول — الكاسيتات ١ إلى ٤');
  });
  it('names a single cassette «الكاسيت ٥», never «الكاسيتات ٥ إلى ٥»', () => {
    expect(bagSlotsText(2, [5], t, 'ar')).toBe('الشوال الثاني — الكاسيت ٥');
    expect(bagSlotsText(2, [5], (k, p) => translate('en', k, p), 'en')).toBe(
      `${translate('en', 'atm.settlement.bag.2')}: cassette 5`,
    );
  });
});

describe('offersLayoutRefresh — «تحديث من فئات الماكينة» (FIT-3)', () => {
  const at = (
    code: string,
    status: 'draft' | 'issued' = 'draft',
    kind: 'machine' | 'spare' = 'machine',
  ) => ({
    status,
    kind,
    issues: [{ code }],
  });
  it('on a draft machine line whose slots, labels or standard load changed', () => {
    expect(offersLayoutRefresh(at('LAYOUT_CHANGED'))).toBe(true);
    expect(offersLayoutRefresh(at('STANDARD_LOAD_CHANGED'))).toBe(true);
  });
  it('never on an issued line, a spare line, or another warning', () => {
    expect(offersLayoutRefresh(at('STANDARD_LOAD_CHANGED', 'issued'))).toBe(false);
    expect(offersLayoutRefresh(at('STANDARD_LOAD_CHANGED', 'draft', 'spare'))).toBe(false);
    expect(offersLayoutRefresh(at('NO_TIME'))).toBe(false);
  });
});

describe('toasts (R4-4)', () => {
  // The shared Toaster shows the title on ONE line and cuts the rest; only the description wraps.
  it('keeps a short sentence as the title', () => {
    expect(toastWords('حُفظ.', 'done', ar)).toEqual({ title: 'حُفظ.' });
  });

  it('puts a long sentence in the description, under a short title', () => {
    for (const t of [ar, en]) {
      const stale = settlementErrorToast(apiError(ErrorCodes.STALE_DOCUMENT), t, 'ar');
      const sentence = settlementErrorText(apiError(ErrorCodes.STALE_DOCUMENT), t, 'ar');
      expect(sentence.length).toBeGreaterThan(TOAST_TITLE_MAX);
      expect(stale).toEqual({ title: t('atm.settlement.toast.failed'), description: sentence });
    }
  });

  it('gives every short title room on that one line', () => {
    for (const t of [ar, en]) {
      for (const kind of ['failed', 'notice', 'done'] as const) {
        const title = t(`atm.settlement.toast.${kind}`);
        expect(title).not.toBe(`atm.settlement.toast.${kind}`);
        expect(title.length).toBeLessThanOrEqual(TOAST_TITLE_MAX);
      }
    }
  });
});
