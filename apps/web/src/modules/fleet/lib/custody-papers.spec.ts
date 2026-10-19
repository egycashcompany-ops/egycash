// The papers' one door: what a saved memo or a recorded letter prints from, the names their PDFs
// are saved under, the print document around the sheets, the print itself (the tab first, before
// any await), the faces (his Windows fonts by name, no file shipped) — and the guards that keep
// his words in their one file and the screens out of the papers.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES as DEFAULTS,
  type FleetCustodyMemoDto,
  type FleetCustodyOperationDto,
} from '@ecms/contracts';
import { openPrintWindow, writePrintWindow } from '../../../shared/lib/print-window';
import {
  PAPER_FACES,
  PAPER_FONT_CSS,
  PAPER_UNICODE_RANGE,
  STACK,
  measureText,
} from './custody-paper-fonts';
import {
  draftLetterFigure,
  letterFileName,
  letterPaperOf,
  letterSheets,
  memoFileName,
  memoPaperOf,
  memoSheets,
  paperDocument,
  paperFontsReady,
  printPaperAfter,
} from './custody-papers';
import { SAMPLE_MEMOS } from './custody-paper-samples';

vi.mock('../../../shared/lib/print-window', () => ({
  openPrintWindow: vi.fn(),
  writePrintWindow: vi.fn(),
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..', '..');

const memoDto = (patch: Partial<FleetCustodyMemoDto> = {}): FleetCustodyMemoDto => ({
  id: 'm-1',
  no: 7,
  kind: 'fuel',
  name: 'وقود سبتمبر',
  date: '2026-09-28',
  from: '2026-09-01',
  to: '2026-09-28',
  receipts: 2,
  total: 1650,
  replenishment: null,
  version: 0,
  createdAt: '2026-09-28T10:00:00.000Z',
  updatedAt: '2026-09-28T10:00:00.000Z',
  lines: [
    {
      receiptId: 'r-1',
      date: '2026-09-01',
      vehicleId: 'v-1',
      vehicleCode: '207',
      driverEmployeeId: null,
      driverName: null,
      amount: 1130,
      fuelType: null,
      litres: null,
      mission: 'ATM',
      statement: '',
      note: '',
    },
    {
      receiptId: 'r-2',
      date: '2026-09-20T00:00:00.000Z',
      vehicleId: 'v-2',
      vehicleCode: null,
      driverEmployeeId: null,
      driverName: null,
      amount: 520,
      fuelType: null,
      litres: null,
      mission: 'شلاتين',
      statement: '',
      note: 'تحت الحساب',
    },
  ],
  signatures: DEFAULTS.fuel,
  ...patch,
});

const opDto = (patch: Partial<FleetCustodyOperationDto>): FleetCustodyOperationDto => ({
  id: 'o-1',
  kind: 'charge',
  date: '2026-10-05',
  from: null,
  to: null,
  amount: 200000,
  reason: '24 سياره تجديد',
  memos: [],
  parts: [],
  fundBefore: 99400,
  chargedTotal: 100000,
  letterFigure: null,
  signatures: DEFAULTS.charge,
  ledger: null,
  version: 0,
  createdAt: '2026-10-05T10:00:00.000Z',
  updatedAt: '2026-10-05T10:00:00.000Z',
  ...patch,
});

describe('a saved memo prints as it was saved', () => {
  it('its lines in its order — the code as stored, the day, his typed cells — and its names', () => {
    const memo = memoDto();
    const paper = memoPaperOf(memo);
    expect(paper).toEqual({
      kind: 'fuel',
      lines: [
        { code: '207', date: '2026-09-01', amount: 1130, mission: 'ATM', statement: '', note: '' },
        {
          code: '',
          date: '2026-09-20',
          amount: 520,
          mission: 'شلاتين',
          statement: '',
          note: 'تحت الحساب',
        },
      ],
      signatures: DEFAULTS.fuel,
    });
    const html = memoSheets(paper).join('');
    expect(html).toContain('<bdi>20/9/2026</bdi>');
    // The memo's name, number and date are the app's — never the paper's.
    expect(html).not.toContain('وقود سبتمبر');
    expect(html).not.toContain('2026-09-28');
  });

  it('prints with the names it was SAVED with, not today’s set-up', () => {
    const snapshot = {
      ...DEFAULTS.fuel,
      blocks: DEFAULTS.fuel.blocks.map((b) =>
        b.role === 'preparer' ? { ...b, name: 'الأستاذ/ اسم وقت الحفظ' } : b,
      ),
    };
    expect(memoSheets(memoPaperOf(memoDto({ signatures: snapshot }))).join('')).toContain(
      'الأستاذ/ اسم وقت الحفظ',
    );
  });
});

describe('a recorded operation prints its letter as it was recorded', () => {
  it('a charge: its date, amount and reason', () => {
    expect(letterPaperOf(opDto({}))).toEqual({
      kind: 'charge',
      date: '2026-10-05',
      amount: 200000,
      reason: '24 سياره تجديد',
      signatures: DEFAULTS.charge,
    });
  });

  it('a replenishment: its memos by kind in his order, its frozen bracket figure', () => {
    const op = opDto({
      kind: 'replenish',
      date: '2026-09-29',
      from: '2026-09-01',
      to: '2026-09-30',
      amount: 81908,
      reason: '',
      letterFigure: 100000,
      signatures: DEFAULTS.replenish,
      memos: [
        {
          memoId: 'a',
          no: 1,
          kind: 'tyres',
          name: '',
          from: '2026-09-01',
          to: '2026-09-15',
          receipts: 18,
          amount: 1690,
        },
        {
          memoId: 'b',
          no: 2,
          kind: 'tyres',
          name: '',
          from: '2026-09-16',
          to: '2026-09-28',
          receipts: 6,
          amount: 960,
        },
        {
          memoId: 'c',
          no: 3,
          kind: 'fuel',
          name: '',
          from: '2026-09-01',
          to: '2026-09-28',
          receipts: 55,
          amount: 49844,
        },
        {
          memoId: 'd',
          no: 4,
          kind: 'maintenance',
          name: '',
          from: '2026-09-04',
          to: '2026-09-13',
          receipts: 3,
          amount: 5720,
        },
        {
          memoId: 'e',
          no: 5,
          kind: 'maintenance',
          name: '',
          from: '2026-09-14',
          to: '2026-09-30',
          receipts: 9,
          amount: 23694,
        },
      ],
    });
    const paper = letterPaperOf(op);
    expect(paper).toMatchObject({
      kind: 'replenish',
      date: '2026-09-29',
      from: '2026-09-01',
      to: '2026-09-30',
      amount: 81908,
      custody: 100000,
      rows: [
        { kind: 'tyres', amount: 2650 },
        { kind: 'fuel', amount: 49844 },
        { kind: 'maintenance', amount: 29414 },
      ],
    });
    expect(letterSheets(paper)[0]).toContain('( ١٠٠,٠٠٠)');
  });

  it('a settlement: one row per licensing memo, oldest first, the fund before it in brackets', () => {
    const op = opDto({
      kind: 'settle',
      amount: 124139.46,
      reason: '',
      letterFigure: 299400,
      signatures: DEFAULTS.settle,
      parts: [
        {
          expenseId: 'x',
          part: 'extension',
          date: '2026-09-10',
          cars: 23,
          codes: [],
          visaTotal: 0,
          cashTotal: 0,
          amount: 100,
        },
        {
          expenseId: 'x',
          part: 'renewal',
          date: '2026-09-10',
          cars: 5,
          codes: [],
          visaTotal: 0,
          cashTotal: 0,
          amount: 200,
        },
      ],
    });
    const paper = letterPaperOf(op);
    expect(paper).toMatchObject({
      kind: 'settle',
      from: null,
      to: null,
      custody: 299400,
      rows: [
        { part: 'renewal', cars: 5, amount: 200 },
        { part: 'extension', cars: 23, amount: 100 },
      ],
    });
  });

  it('a missing bracket figure prints zero rather than nothing', () => {
    expect(letterPaperOf(opDto({ kind: 'replenish', letterFigure: null }))).toMatchObject({
      custody: 0,
    });
  });

  it('a letter still to be recorded shows the bracket figure the API will freeze', () => {
    const fund = { fundTotal: 299400, charged: { count: 2, amount: 300000 } };
    expect(draftLetterFigure('replenish', fund)).toBe(300000);
    expect(draftLetterFigure('settle', fund)).toBe(299400);
  });
});

describe('the name a PDF is saved under', () => {
  it('a memo: the name it was given, its spaces tidied — else his paper’s title', () => {
    expect(memoFileName({ kind: 'tyres', name: '  كاوتش   النصف\tالثاني ' })).toBe(
      'كاوتش النصف الثاني',
    );
    expect(memoFileName({ kind: 'tyres', name: '' })).toBe('مذكرة بمصروفات الكاوتش');
    expect(memoFileName({ kind: 'fuel', name: '   ' })).toBe('مذكرة داخلية بمصروفات التمويل');
    expect(memoFileName({ kind: 'maintenance', name: '' })).toBe('بيان بمصروفات الصيانة');
    expect(memoFileName({ kind: 'wash', name: '' })).toBe('مذكرة بمصروفات الغسيل');
  });

  it('a letter: his title', () => {
    expect(letterFileName('replenish')).toBe('استعاضه عهدة');
    expect(letterFileName('settle')).toBe('تسويه عهدة');
    expect(letterFileName('charge')).toBe('صرف عهدة');
  });
});

describe('the print document', () => {
  const sheets = memoSheets(SAMPLE_MEMOS.tyres);

  it('is a right-to-left Arabic A4 document titled with the file name, escaped', () => {
    const html = paperDocument(sheets, 'كاوتش <b>سبتمبر</b>');
    expect(html.startsWith('<!doctype html><html dir="rtl" lang="ar">')).toBe(true);
    expect(html).toContain('<title>كاوتش &lt;b&gt;سبتمبر&lt;/b&gt;</title>');
    expect(html).toContain('@page{size:A4;margin:0}');
    expect(html).toContain('.xm-sheet,.wl-sheet{break-after:page}');
    expect(html).toContain(sheets[0]);
    expect(html).not.toMatch(/<script/iu);
    expect(html).not.toMatch(/\son[a-z]+=/u);
  });

  it('declares the faces once, however many sheets', () => {
    const count = (html: string): number => html.match(/@font-face/gu)?.length ?? 0;
    expect(count(paperDocument(sheets, 'x'))).toBe(PAPER_FACES.length);
    expect(count(paperDocument([...sheets, ...sheets, ...sheets], 'x'))).toBe(PAPER_FACES.length);
  });
});

describe('the print: the tab first, then the paper', () => {
  const sheets = memoSheets(SAMPLE_MEMOS.wash);
  const open = vi.mocked(openPrintWindow);
  const write = vi.mocked(writePrintWindow);
  beforeEach(() => {
    open.mockReset();
    write.mockReset();
  });

  it('opens the tab before anything is awaited, and writes the composed document into it', async () => {
    const win = { close: vi.fn() } as unknown as Window;
    open.mockReturnValue(win);
    let release: (value: { sheets: readonly string[]; title: string }) => void = () => {};
    const compose = vi.fn(
      () =>
        new Promise<{ sheets: readonly string[]; title: string }>((resolve) => {
          release = resolve;
        }),
    );
    const printing = printPaperAfter(compose, 'جارٍ التجهيز');
    // Synchronously, inside the click: the tab is open and nothing is written yet.
    expect(open).toHaveBeenCalledWith('جارٍ التجهيز');
    expect(write).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(compose).toHaveBeenCalled());
    release({ sheets, title: 'مذكرة' });
    await expect(printing).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith(win, paperDocument(sheets, 'مذكرة'));
    expect(win.close).not.toHaveBeenCalled();
  });

  it('answers false when the browser refused the tab — and composes nothing (no save either)', async () => {
    open.mockReturnValue(null);
    const compose = vi.fn();
    await expect(printPaperAfter(compose, '…')).resolves.toBe(false);
    expect(compose).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('closes the tab and rethrows when composing fails — no empty tab left behind', async () => {
    const win = { close: vi.fn() } as unknown as Window;
    open.mockReturnValue(win);
    const failure = new Error('409');
    await expect(printPaperAfter(() => Promise.reject(failure), '…')).rejects.toBe(failure);
    expect(win.close).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('the faces: his Windows fonts by name, nothing shipped', () => {
  it('declares only installed fonts — no file, no data URI — on the Arabic blocks only', () => {
    expect(PAPER_FONT_CSS).not.toContain('url(');
    expect(PAPER_FONT_CSS).not.toContain('data:');
    for (const face of PAPER_FACES)
      expect(face.src, face.family).toMatch(/^local\("[^"]+"\)(?:,local\("[^"]+"\))*$/u);
    expect(PAPER_UNICODE_RANGE.startsWith('U+0600-06FF')).toBe(true);
    expect(PAPER_FONT_CSS.match(/unicode-range:U\+0600-06FF/gu)).toHaveLength(PAPER_FACES.length);
    // His metrics on the stand-ins, kept exactly.
    expect(PAPER_FONT_CSS).toContain('size-adjust:74%');
    expect(PAPER_FONT_CSS).toContain(
      'ascent-override:95.3%;descent-override:22.3%;line-gap-override:0%',
    );
    expect(PAPER_FONT_CSS).toContain('size-adjust:105.5%');
  });

  it('puts his Windows font first in every stack, the phones’ and Linux’s Arabic after it', () => {
    expect(STACK.cal.startsWith('Calibri,"Segoe UI",')).toBe(true);
    for (const stack of [
      STACK.ari,
      STACK.ariB,
      STACK.ariThin,
      STACK.ariCell,
      STACK.ariTop,
      STACK.arial,
    ]) {
      expect(stack.startsWith('Arial,')).toBe(true);
      expect(stack.endsWith('sans-serif')).toBe(true);
    }
    for (const stack of [STACK.tnr, STACK.tnrC, STACK.tatweel]) {
      expect(stack.startsWith('"Times New Roman",')).toBe(true);
    }
    for (const stack of Object.values(STACK)) {
      expect(stack).toContain('"Noto Naskh Arabic"');
      expect(stack).toContain('"Noto Sans Arabic"');
      expect(stack).toContain('Amiri');
      expect(stack.indexOf('Noto')).toBeGreaterThan(stack.indexOf(stack.split(',')[0]!));
    }
    expect(STACK.tnr.endsWith(',serif')).toBe(true);
  });

  it('needs no document: the faces are ready at once, and nothing measures', async () => {
    await expect(paperFontsReady()).resolves.toBeUndefined();
    expect(paperFontsReady()).toBe(paperFontsReady());
    expect(measureText('عدد 4', '700 11pt Calibri')).toBeNull();
  });
});

/** Every non-spec source file of the web app, comments removed. */
const sources = (dir = SRC): [string, string][] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    if (!/\.tsx?$/u.test(entry.name) || entry.name.includes('.spec.')) return [];
    const code = readFileSync(full, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/^\s*\/\/.*$/gmu, '');
    return [[relative(SRC, full), code] as [string, string]];
  });

describe('his words stay in their one file, and the screens stay out of the papers', () => {
  const all = sources();
  const PAPER_FILE = /^modules\/fleet\/lib\/custody-papers?(?:-[a-z]+)?\.ts$/u;

  it('only the paper engine imports the wording file', () => {
    const importers = all
      .filter(([, code]) => /from '\.{1,2}\/[^']*custody-paper-wording'/u.test(code))
      .map(([file]) => file);
    expect(importers.length).toBeGreaterThan(0);
    for (const file of importers)
      expect(file).toMatch(/^modules\/fleet\/lib\/custody-paper[a-z-]*\.ts$/u);
  });

  it('no paper file reads the dictionary, the locale or the store', () => {
    const papers = all.filter(([file]) => PAPER_FILE.test(file));
    expect(papers.map(([file]) => file).sort()).toEqual(
      [
        'custody-paper-excel.ts',
        'custody-paper-fonts.ts',
        'custody-paper-format.ts',
        'custody-paper-letters.ts',
        'custody-paper-memos.ts',
        'custody-paper-samples.ts',
        'custody-paper-word.ts',
        'custody-paper-wording.ts',
        'custody-papers.ts',
      ].map((name) => `modules/fleet/lib/${name}`),
    );
    for (const [file, code] of papers) {
      expect(code, file).not.toMatch(/localization|useT\b|\/store['/]|\bt\(/u);
    }
  });

  it('the wording file holds his words and nothing else: exported constants only', () => {
    const code = all.find(([file]) => file === 'modules/fleet/lib/custody-paper-wording.ts')![1];
    const topLevel = code.split('\n').filter((line) => /^[a-z]/u.test(line));
    expect(topLevel.length).toBeGreaterThan(10);
    for (const line of topLevel) expect(line).toMatch(/^(?:export const |import type )/u);
  });

  it('no screen draws a paper but through this door', () => {
    const outside = all
      .filter(([file]) => !PAPER_FILE.test(file) && !file.startsWith('zz-'))
      .filter(([, code]) =>
        /from '[^']*lib\/custody-paper-(?:memos|letters|excel|word)'/u.test(code),
      )
      .map(([file]) => file);
    expect(outside).toEqual([]);
  });
});
