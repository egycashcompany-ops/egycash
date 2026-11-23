// «عداد الطابعة» (2026-11-19) — the issue's counter rules, without a browser: which line counts, what
// a counted line needs, the last reading held STRICTLY (the owner's «أقل أو مساوي» refused), the one
// reading of one printer's lines, a moved line losing its reading, the body, and how the server's
// three refusals are read back onto a line's field with their figures. The dialogs that wire them
// are proven in `pages/consumables-screen.spec.tsx` and `components/installed-on-dialog.spec.tsx`.
import { describe, expect, it } from 'vitest';
import { IT_PRINTER_COUNTER_MAX, IssueItConsumablesSchema } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { formatDateTime } from '../../../shared/lib/format';
import {
  backdatedAgainst,
  clearMovedReadings,
  counterBody,
  counterFailures,
  counterLineCheck,
  counterProblemWords,
  counterValue,
  countingTypes,
  countsLine,
  lastReadingWords,
  readingToner,
  refusalAlertWords,
  sentCounterFailures,
  standingFailure,
  type CounterDraftLine,
  type LatestReading,
} from './consumable-counter';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const INK = 'ty-ink';
const CABLES = 'ty-cables';
const counting = countingTypes([
  { id: INK, requiresCounterReading: true },
  { id: CABLES, requiresCounterReading: false },
]);

const PRINTER = '64b0000000000000000000a1';
const OTHER_PRINTER = '64b0000000000000000000a2';

const line = (over: Partial<CounterDraftLine> = {}): CounterDraftLine => ({
  key: 0,
  consumable: { id: 'c-85a', typeId: INK },
  assetId: PRINTER,
  qty: '1',
  counterReading: '12500',
  counterReset: false,
  ...over,
});

const counted = (lines: CounterDraftLine[]) =>
  lines.map((each) => ({ ...each, counts: countsLine(each, counting) }));

const LATEST: NonNullable<LatestReading> = {
  movementId: 'm-prev',
  at: '2026-11-10T09:00:00.000Z',
  reading: 12_400,
  reset: false,
  consumableId: 'c-85a',
  consumableCode: 'CON-00004',
  consumableName: 'حبر HP 85A',
};
const AFTER = new Date('2026-11-19T10:30:00.000Z');
const BEFORE = new Date('2026-11-01T10:30:00.000Z');

const check = (
  subject: CounterDraftLine,
  over: Partial<Parameters<typeof counterLineCheck>[1]> = {},
) =>
  counterLineCheck(subject, {
    counts: countsLine(subject, counting),
    canAssets: true,
    latest: LATEST,
    issuedAt: AFTER,
    lines: counted([subject]),
    ...over,
  });

describe('which line takes the printer’s counter', () => {
  it('an item whose TYPE is ticked «يتطلب عداد الطباعة» — and no other', () => {
    expect(countsLine(line(), counting)).toBe(true);
    expect(countsLine(line({ consumable: { id: 'c-vga', typeId: CABLES } }), counting)).toBe(false);
    expect(countsLine(line({ consumable: null }), counting)).toBe(false);
  });

  it('a catalog that could not be read counts nothing: the server, which reads the type, judges', () => {
    expect(countsLine(line(), countingTypes(undefined))).toBe(false);
  });

  it('a line that does not count is never held up by the counter', () => {
    const cable = line({ consumable: { id: 'c-vga', typeId: CABLES }, assetId: '', qty: '5' });
    expect(check(cable)).toEqual({ ok: true, printer: null, qty: null, reading: null });
    expect(counterBody(cable, false)).toEqual({});
  });
});

describe('what a counted line needs', () => {
  it('the register of devices: without `itAsset.view` it cannot name its printer, and says so', () => {
    expect(check(line(), { canAssets: false })).toEqual({
      ok: false,
      printer: { kind: 'needsAssets' },
      qty: null,
      reading: null,
    });
  });

  it('its printer and its reading — empty boxes hold the save without a word under them', () => {
    expect(check(line({ assetId: '' }))).toEqual({
      ok: false,
      printer: null,
      qty: null,
      reading: null,
    });
    expect(check(line({ counterReading: '  ' }))).toEqual({
      ok: false,
      printer: null,
      qty: null,
      reading: null,
    });
  });

  it('one cartridge a line', () => {
    expect(check(line({ qty: '2' }))).toMatchObject({ ok: false, qty: { kind: 'oneCartridge' } });
  });

  it('a whole number within the contract’s bound', () => {
    for (const typed of ['12.5', '-1', 'abc', String(IT_PRINTER_COUNTER_MAX + 1)]) {
      expect(check(line({ counterReading: typed })), typed).toMatchObject({
        ok: false,
        reading: { kind: 'readingInvalid' },
      });
    }
    expect(counterValue(' 0 ')).toBe(0);
    expect(counterValue(String(IT_PRINTER_COUNTER_MAX))).toBe(IT_PRINTER_COUNTER_MAX);
    expect(Number.isNaN(counterValue(''))).toBe(true);
  });
});

describe('the printer’s last reading — STRICTLY greater («أقل أو مساوي» refused)', () => {
  it('above it: fine', () => {
    expect(check(line({ counterReading: '12401' })).ok).toBe(true);
  });

  it('EQUAL to it is refused, as below it is — with the figures it was held against', () => {
    for (const typed of ['12400', '9000']) {
      expect(check(line({ counterReading: typed })), typed).toEqual({
        ok: false,
        printer: null,
        qty: null,
        reading: { kind: 'belowPrevious', reading: 12_400, at: LATEST.at },
      });
    }
  });

  it('a reset may be at or below it: the counter starts again', () => {
    expect(check(line({ counterReading: '0', counterReset: true })).ok).toBe(true);
    expect(check(line({ counterReading: '12400', counterReset: true })).ok).toBe(true);
  });

  it('a printer with no reading yet takes any reading; one not read yet is left to the server', () => {
    expect(check(line({ counterReading: '0' }), { latest: null }).ok).toBe(true);
    expect(check(line({ counterReading: '0' }), { latest: undefined }).ok).toBe(true);
  });

  it('a memo dated BEFORE that reading is backdated: only the server can place it, and it does', () => {
    expect(check(line({ counterReading: '100' }), { issuedAt: BEFORE }).ok).toBe(true);
    expect(backdatedAgainst(LATEST, BEFORE)).toBe(true);
    expect(backdatedAgainst(LATEST, AFTER)).toBe(false);
    // The same moment is not before it: held strictly.
    expect(backdatedAgainst(LATEST, new Date(LATEST.at))).toBe(false);
    expect(check(line({ counterReading: '12400' }), { issuedAt: new Date(LATEST.at) }).ok).toBe(
      false,
    );
    expect(backdatedAgainst(null, BEFORE)).toBe(false);
    expect(backdatedAgainst(undefined, BEFORE)).toBe(false);
  });
});

describe('one printer’s lines carry one reading — one display, one moment', () => {
  const black = line({ key: 0, consumable: { id: 'c-k', typeId: INK }, counterReading: '12500' });
  const cyan = line({ key: 1, consumable: { id: 'c-c', typeId: INK }, counterReading: '12500' });

  it('the same reading on two lines is the ONE equal the rule allows', () => {
    const lines = counted([black, cyan]);
    expect(check(black, { lines }).ok).toBe(true);
    expect(check(cyan, { lines }).ok).toBe(true);
  });

  it('another reading, or another reset, on a later line is refused there, naming the first', () => {
    for (const other of [
      { ...cyan, counterReading: '12600' },
      { ...cyan, counterReset: true },
    ]) {
      const lines = counted([black, other]);
      expect(check(black, { lines }).ok).toBe(true);
      expect(check(other, { lines })).toMatchObject({
        ok: false,
        reading: { kind: 'sameReading', line: 1 },
      });
    }
  });

  it('a line on another printer, a line with no reading yet and a line that does not count are not compared', () => {
    const elsewhere = { ...cyan, key: 3, assetId: OTHER_PRINTER, counterReading: '300' };
    const empty = { ...cyan, counterReading: '' };
    const cable = line({
      key: 2,
      consumable: { id: 'c-vga', typeId: CABLES },
      counterReading: '7',
    });
    const lines = counted([empty, black, elsewhere, cable]);
    expect(check(black, { lines }).ok).toBe(true);
    // The other printer has no reading yet: 300 is its first.
    expect(check(elsewhere, { lines, latest: null }).ok).toBe(true);
  });

  it('what the dialog allows, the contract accepts — and what it refuses, the contract refuses too', () => {
    const body = (lines: CounterDraftLine[]) => ({
      employeeId: '64b000000000000000000001',
      lines: lines.map((each) => ({
        consumableId: `64b0000000000000000000c${String(each.key)}`,
        qty: 1,
        assetId: each.assetId,
        ...counterBody(each, true),
      })),
    });
    expect(IssueItConsumablesSchema.safeParse(body([black, cyan])).success).toBe(true);
    expect(
      IssueItConsumablesSchema.safeParse(body([black, { ...cyan, counterReading: '12600' }]))
        .success,
    ).toBe(false);
  });
});

describe('a moved line starts again', () => {
  const before = [
    { key: 0, assetId: PRINTER, asset: null, counterReading: '12500', counterReset: true },
    { key: 1, assetId: OTHER_PRINTER, asset: null, counterReading: '300', counterReset: false },
  ];

  it('a line whose device changed loses its reading and its reset; the others keep theirs', () => {
    const after = [{ ...before[0]!, assetId: '' }, before[1]!];
    expect(clearMovedReadings(before, after)).toEqual([
      { key: 0, assetId: '', asset: null, counterReading: '', counterReset: false },
      before[1],
    ]);
  });

  it('nothing moved — the very same lines, so the reducer’s state keeps its identity', () => {
    const after = [...before];
    expect(clearMovedReadings(before, after)).toBe(after);
    // A line moved with nothing typed on it yet has nothing to lose.
    const blank = [{ ...before[0]!, counterReading: '', counterReset: false }];
    const moved = [{ ...blank[0]!, assetId: OTHER_PRINTER }];
    expect(clearMovedReadings(blank, moved)).toBe(moved);
  });
});

describe('the body', () => {
  it('a counted line sends its reading, and the reset only when ticked', () => {
    expect(counterBody(line(), true)).toEqual({ counterReading: 12_500 });
    expect(counterBody(line({ counterReading: '0', counterReset: true }), true)).toEqual({
      counterReading: 0,
      counterReset: true,
    });
  });
});

describe('the server’s refusals, read back onto the line', () => {
  const below = new ApiError(
    'IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS',
    'the counter reading 12400 is not above AST-00031’s last reading',
    422,
    [
      { field: 'lines.1.counterReading', code: 'PREVIOUS_READING', message: '12400' },
      { field: 'lines.1.counterReading', code: 'PREVIOUS_AT', message: LATEST.at },
    ],
  );

  it('BELOW_PREVIOUS: the line, the field, and the reading it was held against', () => {
    expect(counterFailures(below)).toEqual([
      {
        index: 1,
        field: 'counterReading',
        problem: { kind: 'belowPrevious', reading: 12_400, at: LATEST.at },
      },
    ]);
  });

  it('ABOVE_NEXT on «تعديل الجهاز» — no line, the PATCH’s own field', () => {
    const above = new ApiError('IT_CONSUMABLE_COUNTER_ABOVE_NEXT', 'not below', 422, [
      { field: 'counterReading', code: 'NEXT_READING', message: '15000' },
      { field: 'counterReading', code: 'NEXT_AT', message: '2026-11-15T09:00:00.000Z' },
    ]);
    expect(counterFailures(above)).toEqual([
      {
        index: null,
        field: 'counterReading',
        problem: { kind: 'aboveNext', reading: 15_000, at: '2026-11-15T09:00:00.000Z' },
      },
    ]);
  });

  it('REQUIRED: one refusal per gap, each on its own field', () => {
    const required = new ApiError('IT_CONSUMABLE_COUNTER_REQUIRED', 'required', 422, [
      { field: 'lines.0.assetId', code: 'REQUIRED', message: 'name the printer' },
      { field: 'lines.0.counterReading', code: 'REQUIRED', message: 'its reading' },
      { field: 'body.lines.2.qty', code: 'ONE_CARTRIDGE', message: 'one cartridge' },
    ]);
    expect(counterFailures(required)).toEqual([
      { index: 0, field: 'assetId', problem: { kind: 'printerRequired' } },
      { index: 0, field: 'counterReading', problem: { kind: 'readingRequired' } },
      { index: 2, field: 'qty', problem: { kind: 'oneCartridge' } },
    ]);
  });

  it('a refusal the server could not put figures to is still said — without them', () => {
    const bare = new ApiError('IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS', 'not above', 422, [
      { field: 'lines.0.counterReading', code: 'PREVIOUS_READING', message: 'twelve' },
    ]);
    expect(counterFailures(bare)).toEqual([
      {
        index: 0,
        field: 'counterReading',
        problem: { kind: 'belowPrevious', reading: null, at: null },
      },
    ]);
  });

  it('anywhere else it surfaces (a toast), the platform words it in the reader’s language', () => {
    for (const code of [
      'IT_CONSUMABLE_COUNTER_REQUIRED',
      'IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS',
      'IT_CONSUMABLE_COUNTER_ABOVE_NEXT',
    ]) {
      const error = new ApiError(code, 'the counter reading 12400 is not above …', 422);
      const words = errorMessage(error, 'ar');
      expect(words, code).not.toBe(error.message);
      expect(words, code).toMatch(/[ء-ي]/u);
      expect(errorMessage(error, 'en'), code).not.toBe(error.message);
    }
  });

  it('any other error is none of the counter’s', () => {
    expect(counterFailures(new ApiError('BUSINESS_RULE', 'no', 422))).toEqual([]);
    expect(counterFailures(new Error('offline'))).toEqual([]);
  });

  /** The memo's date box as it was sent, and as it is after the user moves it back a week. */
  const SENT_AT = '2026-11-19T10:30';
  const MOVED_AT = '2026-11-12T10:30';

  it('stands on the line it named while that line is as it was sent — and goes once it is edited', () => {
    const sent = [line({ key: 7 }), line({ key: 9, counterReading: '12400' })];
    const pinned = sentCounterFailures(counterFailures(below), sent, SENT_AT);
    expect(pinned).toHaveLength(1);
    expect(standingFailure(pinned, sent[1]!, 'counterReading', SENT_AT)).toEqual({
      kind: 'belowPrevious',
      reading: 12_400,
      at: LATEST.at,
    });
    expect(standingFailure(pinned, sent[0]!, 'counterReading', SENT_AT)).toBeNull();
    expect(standingFailure(pinned, sent[1]!, 'assetId', SENT_AT)).toBeNull();
    // Typed again, or ticked as a reset: the server has not said anything about that.
    expect(
      standingFailure(pinned, { ...sent[1]!, counterReading: '12401' }, 'counterReading', SENT_AT),
    ).toBeNull();
    expect(
      standingFailure(pinned, { ...sent[1]!, counterReset: true }, 'counterReading', SENT_AT),
    ).toBeNull();
    // A line removed since: the index no longer names it, so nothing is pinned to another line.
    expect(sentCounterFailures(counterFailures(below), [sent[0]!], SENT_AT)).toEqual([]);
  });

  it('a refused reading goes once the memo’s DATE moves — the date placed it; another is another verdict', () => {
    const above = new ApiError('IT_CONSUMABLE_COUNTER_ABOVE_NEXT', 'not below', 422, [
      { field: 'lines.0.counterReading', code: 'NEXT_READING', message: '15000' },
      { field: 'lines.0.counterReading', code: 'NEXT_AT', message: '2026-11-15T09:00:00.000Z' },
    ]);
    for (const error of [below, above]) {
      const sent = [line({ key: 7 }), line({ key: 9, counterReading: '12400' })];
      const [refused] = counterFailures(error);
      const subject = sent[refused!.index!]!;
      const pinned = sentCounterFailures(counterFailures(error), sent, SENT_AT);
      expect(standingFailure(pinned, subject, 'counterReading', SENT_AT), error.code).toEqual(
        refused!.problem,
      );
      // Only the date changed — the line is exactly as it was sent.
      expect(standingFailure(pinned, subject, 'counterReading', MOVED_AT), error.code).toBeNull();
      expect(standingFailure(pinned, subject, 'counterReading', ''), error.code).toBeNull();
      // Moved back to the date it was sent with: what the server said of that date stands again.
      expect(standingFailure(pinned, subject, 'counterReading', SENT_AT), error.code).toEqual(
        refused!.problem,
      );
    }
    // Sent as «now» (an emptied box, stamped by the server) and still «now»: it stands.
    const now = sentCounterFailures(counterFailures(below), [line(), line({ key: 9 })], '');
    expect(standingFailure(now, line({ key: 9 }), 'counterReading', '')).not.toBeNull();
    expect(standingFailure(now, line({ key: 9 }), 'counterReading', SENT_AT)).toBeNull();
  });

  it('what the date does not decide stands across it: the printer, the reading and one cartridge', () => {
    const required = new ApiError('IT_CONSUMABLE_COUNTER_REQUIRED', 'required', 422, [
      { field: 'lines.0.assetId', code: 'REQUIRED', message: 'name the printer' },
      { field: 'lines.0.counterReading', code: 'REQUIRED', message: 'its reading' },
      { field: 'lines.0.qty', code: 'ONE_CARTRIDGE', message: 'one cartridge' },
    ]);
    const subject = line({ assetId: '', counterReading: '', qty: '2' });
    const pinned = sentCounterFailures(counterFailures(required), [subject], SENT_AT);
    expect(standingFailure(pinned, subject, 'assetId', MOVED_AT)).toEqual({
      kind: 'printerRequired',
    });
    expect(standingFailure(pinned, subject, 'counterReading', MOVED_AT)).toEqual({
      kind: 'readingRequired',
    });
    expect(standingFailure(pinned, subject, 'qty', MOVED_AT)).toEqual({ kind: 'oneCartridge' });
  });

  it('the dialog’s alert says the refusal as its field does, with the figure — not the bare words', () => {
    const pinned = sentCounterFailures(
      counterFailures(below),
      [line({ key: 7 }), line({ key: 9, counterReading: '12400' })],
      SENT_AT,
    );
    const words = refusalAlertWords(t, pinned, below, 'ar');
    expect(words).toBe(
      counterProblemWords(t, { kind: 'belowPrevious', reading: 12_400, at: LATEST.at }, 'ar'),
    );
    expect(words).toContain('١٢٬٤٠٠');
    expect(words).not.toBe(errorMessage(below, 'ar'));
    // A counter refusal that named no line of the memo: the platform's words for its code.
    expect(refusalAlertWords(t, [], below, 'ar')).toBe(errorMessage(below, 'ar'));
    expect(refusalAlertWords(t, [], below, 'ar')).not.toBe(below.message);
    // Any other error is the dialog's to word, as it words its other failures.
    expect(refusalAlertWords(t, [], new ApiError('BUSINESS_RULE', 'no', 422), 'ar')).toBeNull();
    expect(refusalAlertWords(t, [], new Error('offline'), 'ar')).toBeNull();
  });
});

describe('in words', () => {
  it('the last reading, its date, and the toner it was taken with', () => {
    expect(lastReadingWords(t, LATEST, 'ar')).toBe(
      `آخر قراءة مسجّلة لهذه الطابعة: ١٢٬٤٠٠ — ${formatDateTime(LATEST.at, 'ar')}`,
    );
    expect(readingToner(LATEST)).toBe('حبر HP 85A (CON-00004)');
    expect(readingToner({ consumableName: null, consumableCode: 'CON-00004' })).toBe('CON-00004');
    expect(readingToner({ consumableName: null, consumableCode: null })).toBeNull();
  });

  it('a refused reading says the figure it was held against', () => {
    expect(
      counterProblemWords(t, { kind: 'belowPrevious', reading: 12_400, at: LATEST.at }, 'ar'),
    ).toBe(
      `القراءة يجب أن تكون أكبر من آخر قراءة مسجّلة لهذه الطابعة (١٢٬٤٠٠ بتاريخ ${formatDateTime(LATEST.at, 'ar')}). وإذا صُفِّر عداد الطابعة فحدِّد «تم تصفير عداد الطابعة».`,
    );
    expect(
      counterProblemWords(t, { kind: 'aboveNext', reading: 15_000, at: LATEST.at }, 'ar'),
    ).toContain('١٥٬٠٠٠');
    expect(counterProblemWords(t, { kind: 'belowPrevious', reading: null, at: null }, 'ar')).toBe(
      t('it.consumables.counter.belowPreviousBare'),
    );
    expect(counterProblemWords(t, { kind: 'sameReading', line: 1 }, 'ar')).toContain('الصنف ١');
  });

  it('every problem has its words in both languages', () => {
    const problems = [
      { kind: 'needsAssets' },
      { kind: 'printerRequired' },
      { kind: 'readingRequired' },
      { kind: 'readingInvalid' },
      { kind: 'oneCartridge' },
      { kind: 'belowPrevious', reading: 1, at: LATEST.at },
      { kind: 'belowPrevious', reading: null, at: null },
      { kind: 'aboveNext', reading: 1, at: LATEST.at },
      { kind: 'aboveNext', reading: null, at: null },
      { kind: 'sameReading', line: 2 },
    ] as const;
    for (const locale of ['ar', 'en'] as const) {
      const say = (key: string, params?: Record<string, string | number>): string =>
        translate(locale, key, params);
      for (const problem of problems) {
        const words = counterProblemWords(say, problem, locale);
        expect(words, `${locale} ${problem.kind}`).not.toContain('it.consumables');
        expect(words).not.toContain('{{');
      }
    }
  });
});
