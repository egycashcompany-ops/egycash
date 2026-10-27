// The Note (docs/12-planning/atm-settlements-phase1.md §8.2, §10.4). Invented data only:
// `BRKN9001`, «ماكينة اختبار 1».
import { type AtmNotePrintDto, type AtmPlanSlot } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import {
  NOTE_COLUMN_SHARES,
  NOTE_STYLE,
  buildNotesHtml,
  noteGeometry,
  noteRow,
} from './note-print';
import { NOTE_WORDS } from './settlement-paper-wording';
import { settlementPaperWords } from './settlement-print';

const planned = (slot: number, denomination: number, notes: number, bag: 1 | 2 | null = 1) =>
  ({ slot, kind: 'withdrawal', denomination, currency: 'EGP', notes, bag }) as AtmPlanSlot;

type Note = AtmNotePrintDto['notes'][number];

const note = (over: Partial<Note> = {}): Note => ({
  lineId: 'line-1',
  version: 3,
  serial: 1027,
  kind: 'machine',
  machineCode: 'BRKN9001',
  machineName: 'ماكينة اختبار 1',
  hubLabel: 'منطقة اختبار',
  typeLabel: 'BRK (T1)',
  featuresLabel: 'Withdrawall',
  spareCode: null,
  run: 2,
  scheduleTime: '21:00',
  slots: [planned(1, 200, 4000), planned(2, 200, 4000), planned(3, 100, 2000), planned(4, 50, 0)],
  bagCount: 1,
  egpTotalMinor: (4000 * 200 + 4000 * 200 + 2000 * 100) * 100,
  ...over,
});

const doc = (notes: Note[]): AtmNotePrintDto => ({
  branchName: { ar: 'فرع اختبار', en: 'Test branch' },
  bankCode: 'BRK',
  bankNameAr: 'بنك البركة',
  replenishDate: '2026-10-27',
  printedAt: '2026-10-26T17:03:09Z',
  notes,
});

interface Cell {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  cls: string;
  inner: string;
}

/** Every box of the document, with its paper coordinates (end edges inclusive). */
const boxes = (html: string): Cell[] =>
  [
    ...html.matchAll(
      /<div class="x([^"]*)" style="grid-area: (\d+) \/ (\d+) \/ (\d+) \/ (\d+);[^"]*"[^>]*>(.*?)<\/div>/gu,
    ),
  ].map((m) => ({
    cls: m[1] ?? '',
    r1: Number(m[2]),
    c1: Number(m[3]),
    r2: Number(m[4]) - 1,
    c2: Number(m[5]) - 1,
    inner: m[6] ?? '',
  }));

const text = (inner: string): string => inner.replace(/<[^>]+>/gu, '');
const L = 12;
const K = 11;
const F = 6;

describe('the Note’s words and fields', () => {
  const html = buildNotesHtml(doc([note()]));

  it('prints the owner’s words verbatim, the return half’s included', () => {
    for (const word of [
      NOTE_WORDS.title,
      NOTE_WORDS.bagLock,
      NOTE_WORDS.bagReturn,
      NOTE_WORDS.machineTotal,
      NOTE_WORDS.egpOnly,
      NOTE_WORDS.contains,
      NOTE_WORDS.unloadTechStamp,
      NOTE_WORDS.dataEntryStamp,
      NOTE_WORDS.techAck,
      NOTE_WORDS.total,
    ]) {
      expect(html, word).toContain(word);
    }
    expect(html).toContain('إجمالى قيمة الماكينة');
    expect(html).toContain('ختم و إسم فنى التجهيز لتفريغ الماكينة');
  });

  it('aligns «جنية مصرى فقط لا غير» right in F:H, beside the total (LIVE-6)', () => {
    const cell = boxes(html).find((c) => text(c.inner) === NOTE_WORDS.egpOnly);
    expect(cell?.c1).toBe(F);
    expect(cell?.cls).toBe(' right');
    const tag = html.slice(html.lastIndexOf('<div', html.indexOf(NOTE_WORDS.egpOnly)));
    expect(/^<div[^>]*>/u.exec(tag)?.[0]).toContain('dir="rtl"');
    // In a dir="rtl" flex row the START is the right side; flex-end would be the left.
    expect(NOTE_STYLE).toContain(
      '.note .right { justify-content: flex-start; padding-right: 1mm; }',
    );
    expect(NOTE_STYLE).not.toContain('flex-end');
  });

  it('carries the serial, the REPLENISHMENT date as d/m/yyyy and the run band', () => {
    const cells = boxes(html);
    const serial = cells.find((c) => c.r1 === 6 && c.c1 === 10);
    expect(text(serial?.inner ?? '')).toBe('1027');
    const date = cells.find((c) => c.r1 === 9 && c.c1 === 2);
    expect(text(date?.inner ?? '')).toBe('27/10/2026');
    const band = cells.find((c) => c.r1 === 11 && c.c1 === 2 && c.c2 === L);
    expect(text(band?.inner ?? '')).toBe('التغذية الثانية — الساعة 9:00 م');
    // The print stamp keeps the paper's own m/d/yy h:mm:ss, on the Cairo clock.
    expect(html).toContain('10/26/26 20:03:09');
  });

  it('draws the paper’s corrected column widths', () => {
    expect([...NOTE_COLUMN_SHARES]).toEqual([
      2.6, 6.6, 8.4, 6.2, 8.9, 8.9, 8.9, 5.7, 8.9, 11.6, 12, 8.8, 2.6,
    ]);
    expect(html).toContain(
      'grid-template-columns: 2.6fr 6.6fr 8.4fr 6.2fr 8.9fr 8.9fr 8.9fr 5.7fr 8.9fr 11.6fr 12fr 8.8fr 2.6fr;',
    );
  });

  it('prints «المنطقة» from the hub label and a blank type label blank', () => {
    const cells = boxes(html);
    expect(text(cells.find((c) => c.r1 === 6 && c.c1 === 5)?.inner ?? '')).toBe('منطقة اختبار');
    const blank = boxes(buildNotesHtml(doc([note({ typeLabel: null })])));
    expect(blank.find((c) => c.r1 === 6 && c.c1 === 7)?.inner).toBe('');
  });

  it('converts the total once: an invented 4,000-note 200 cassette alone is 800,000', () => {
    const one = buildNotesHtml(
      doc([note({ slots: [planned(1, 200, 4000)], egpTotalMinor: 4000 * 200 * 100 })]),
    );
    const total = boxes(one).find((c) => c.r1 === 22 && c.c1 === 9);
    expect(text(total?.inner ?? '')).toBe('800,000');
    expect(one).toContain('4,000');
  });
});

describe('4 to 8 cassettes', () => {
  it('moves the lower half by the row rule and scales the unit to stay on one page', () => {
    expect(noteGeometry(4)).toEqual({ k: 0, rows: 72, unitMm: 3.75 });
    expect(noteGeometry(3)).toEqual({ k: 0, rows: 72, unitMm: 3.75 });
    const eight = noteGeometry(8);
    expect(eight.k).toBe(4);
    expect(eight.rows).toBe(88);
    expect(eight.unitMm).toBeCloseTo(270 / 88, 6);
    expect([
      noteRow(21, 4),
      noteRow(22, 4),
      noteRow(58, 4),
      noteRow(59, 4),
      noteRow(72, 4),
    ]).toEqual([21, 30, 66, 75, 88]);
  });

  it('an 8-cassette Note prints 8 filling and 8 unload rows, two bags, on one scaled page', () => {
    const slots = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => planned(n, 100, 1000, n <= 4 ? 1 : 2));
    const html = buildNotesHtml(
      doc([note({ slots, bagCount: 2, egpTotalMinor: 8 * 1000 * 100 * 100 })]),
    );
    expect(html.match(/<section class="page">/gu)).toHaveLength(1);
    expect(html).toContain('grid-template-rows: repeat(88, 3.0682mm);');
    expect(html).toContain('--k: 0.8182;');
    const cells = boxes(html);
    const filling = cells.filter((c) => c.c1 === L && c.r1 >= 14 && c.r1 <= 29);
    expect(filling.map((c) => text(c.inner))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    const unload = cells.filter((c) => c.c1 === L && c.r1 >= 59 && c.r1 <= 74);
    expect(unload.map((c) => c.r1)).toEqual([59, 61, 63, 65, 67, 69, 71, 73]);
    // The data-entry stamp's box moves its edges with the unload block: B57:C74.
    const stamp = cells.find((c) => text(c.inner) === NOTE_WORDS.dataEntryStamp);
    expect(stamp).toMatchObject({ r1: 57, r2: 74, c1: 2, c2: 3 });
    // The machine total moved down 2k rows; the timestamp sits on the last row.
    expect(cells.some((c) => c.r1 === 30 && c.c1 === 9)).toBe(true);
    expect(cells.find((c) => c.r1 === 88 && c.c1 === 7)).toBeDefined();
  });

  it('two bags: the «الحقيبة» column with each cassette’s bag, and split bag boxes', () => {
    const slots = [1, 2, 3, 4, 5].map((n) => planned(n, 50, 500, n <= 4 ? 1 : 2));
    const html = buildNotesHtml(doc([note({ slots, bagCount: 2 })]));
    const cells = boxes(html);
    const header = cells.find((c) => c.c1 === F && c.r1 === 12);
    expect(text(header?.inner ?? '')).toBe('الحقيبة');
    const bags = cells.filter((c) => c.c1 === F && c.r1 >= 14 && c.r1 <= 23);
    expect(bags.map((c) => text(c.inner))).toEqual(['1', '1', '1', '1', '2']);
    // K6:L7 and B6:D7 are split into «1» over «2».
    const lock = cells.filter((c) => c.c1 === K && (c.r1 === 6 || c.r1 === 7));
    expect(lock.map((c) => [c.r1, c.r2, text(c.inner)])).toEqual([
      [6, 6, '1'],
      [7, 7, '2'],
    ]);
    // One bag: no bag column, one whole box.
    const single = boxes(buildNotesHtml(doc([note()])));
    expect(single.some((c) => c.c1 === F && c.r1 === 12)).toBe(false);
    expect(single.filter((c) => c.c1 === K && c.r1 === 6)).toEqual([
      expect.objectContaining({ r1: 6, r2: 7, inner: '' }),
    ]);
  });

  it('a reversed 0/50/100/200 layout prints three cassette rows and three unload rows', () => {
    const slots = [planned(2, 50, 1000), planned(3, 100, 1000), planned(4, 200, 1000)];
    const cells = boxes(buildNotesHtml(doc([note({ slots })])));
    const filling = cells.filter((c) => c.c1 === L && c.r1 >= 14 && c.r1 <= 21);
    expect(filling.map((c) => [c.r1, text(c.inner)])).toEqual([
      [14, '2'],
      [16, '3'],
      [18, '4'],
    ]);
    const unload = cells.filter((c) => c.c1 === L && c.r1 >= 51 && c.r1 <= 58);
    expect(unload.map((c) => text(c.inner))).toEqual(['2', '3', '4']);
    // The unused fourth pair of rows stays blank, without boxes.
    expect(cells.some((c) => c.r1 === 20 && c.c1 >= 7)).toBe(false);
  });

  it('a deposit slot is absent from both sections', () => {
    const slots = [
      planned(1, 200, 1000),
      { slot: 2, kind: 'deposit', denomination: null, currency: 'EGP', notes: 0, bag: null },
      planned(3, 100, 1000),
    ] as AtmPlanSlot[];
    const cells = boxes(buildNotesHtml(doc([note({ slots })])));
    const numbers = cells
      .filter((c) => c.c1 === L && (c.r1 < 30 || c.r1 > 50))
      .map((c) => text(c.inner));
    expect(numbers.filter((n) => n === '2')).toEqual([]);
    expect(numbers.filter((n) => n === '1')).toHaveLength(2);
    expect(numbers.filter((n) => n === '3')).toHaveLength(2);
  });
});

describe('a spare Note', () => {
  it('prints the spare code (or «—») and «طقم سبير» with its type', () => {
    const spare = note({
      kind: 'spare',
      machineCode: null,
      machineName: null,
      spareCode: 'SP-T-1',
    });
    const cells = boxes(buildNotesHtml(doc([spare, { ...spare, spareCode: null }])));
    const codes = cells.filter((c) => c.r1 === 9 && c.c1 === K).map((c) => text(c.inner));
    expect(codes).toEqual(['SP-T-1', '—']);
    const names = cells.filter((c) => c.r1 === 9 && c.c1 === 5).map((c) => text(c.inner));
    expect(names).toEqual(['طقم سبير BRK (T1)', 'طقم سبير BRK (T1)']);
  });
});

describe('the print document', () => {
  const three = buildNotesHtml(doc([note(), note({ serial: 1028 }), note({ serial: 1029 })]));

  it('one page per Note, A4 portrait with no margin, colours kept, the logo written ONCE', () => {
    expect(three.match(/<section class="page">/gu)).toHaveLength(3);
    expect(three).toContain('@page { size: A4 portrait; margin: 0; }');
    expect(three).toContain('print-color-adjust: exact');
    expect(three.match(/data:image\/png;base64,/gu)).toHaveLength(1);
    expect(three.match(/class="x egc-logo"/gu)).toHaveLength(3);
    expect(three).toContain('.page:last-of-type { break-after: auto; }');
  });

  it('carries no script and no inline handler; its buttons are data-print / data-close', () => {
    expect(three).not.toMatch(/<script\b/iu);
    expect(three).not.toMatch(/\son[a-z]+=["']/u);
    expect(three).toContain('data-print');
    expect(three).toContain('data-close');
  });

  it('escapes every value', () => {
    const html = buildNotesHtml(
      doc([note({ machineName: '<b>"x" & \'y\'</b>', typeLabel: '<script>' })]),
    );
    expect(html).toContain('&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
    expect(html).not.toContain('<script>');
  });

  it('prints Arabic words whatever the screen’s language', () => {
    expect(settlementPaperWords().run[1]).toBe('التغذية الأولى');
    expect(settlementPaperWords().bag).toBe('الحقيبة');
    expect(three).toContain('التغذية الثانية');
    expect(three).toContain('<html lang="ar">');
  });
});
