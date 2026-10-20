// His four Excel memos, pinned against his own papers (the approved scenario): every printed word
// in his spelling and spacing, his formats, his signers in his order — and nothing of the app's on
// them (no memo number, no name, no date). Plus the run-on rule for long memos.
import { DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES as DEFAULTS } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { MEMO_CSS } from './custody-paper-excel';
import {
  memoSheets,
  memoTotal,
  type MemoPaperInput,
  type MemoPaperLine,
} from './custody-paper-memos';
import { SAMPLE_FUEL_LINES, SAMPLE_MEMOS } from './custody-paper-samples';

/** What a sheet reads: no styles, no tags, the entities back to their characters. */
const textOf = (html: string): string =>
  html
    .replace(/<style>[\s\S]*?<\/style>/gu, '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, '&');

/** Where each string first appears — to pin their order. */
const inOrder = (html: string, words: readonly string[]): void => {
  let at = -1;
  for (const word of words) {
    const next = html.indexOf(word, at + 1);
    expect(next, word).toBeGreaterThan(at);
    at = next;
  }
};

/** The row numbers a sheet prints, in order. */
const rowNumbers = (html: string, kind: MemoPaperInput['kind']): number[] => {
  // Fuel: «م» sits on its grey fill; the others: the first column's 12/13pt bold cell.
  const re =
    kind === 'fuel'
      ? /background:#d9d9d9;padding-bottom:[\d.]+px"><bdi>(\d+)<\/bdi>/gu
      : /<div class="xc c cal b" style="right:0px;[^"]*"><bdi>(\d+)<\/bdi>/gu;
  return [...html.matchAll(re)].map((m) => Number(m[1]));
};

const lines = (count: number, base: readonly MemoPaperLine[]): MemoPaperLine[] =>
  Array.from({ length: count }, (_, i) => base[i % base.length]!);

describe('his tyres memo (memo 1 — 18 lines, 1,690)', () => {
  const sheets = memoSheets(SAMPLE_MEMOS.tyres);
  const html = sheets[0]!;

  it('is one A4 sheet, his title underlined with its two trailing spaces', () => {
    expect(sheets).toHaveLength(1);
    expect(html).toMatch(/class="xc c m cal b u"[^>]*>مذكرة بمصروفات الكاوتش {2}<\/div>/u);
    expect(html).toMatch(/;background:#d9d9d9">بيان بمصروفات الكاوتش<\/div>/u);
    inOrder(html, ['>م<', '>الكود<', '>القيمة<']);
  });

  it('totals in Excel’s «General»: 1690 — not 1,690, not 1690.00', () => {
    expect(html).toContain('>الاجمالى النهائى</div>');
    expect(html).toContain('<bdi>1690</bdi>');
    expect(html).not.toContain('1,690');
    expect(html).not.toContain('1690.00');
    expect(memoTotal(SAMPLE_MEMOS.tyres.lines)).toBe(1690);
    expect(rowNumbers(html, 'tyres')).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it('rounds each line half up to the piastre before adding — the API’s total, to the piastre', () => {
    const line = (amount: number) => ({ ...SAMPLE_MEMOS.tyres.lines[0]!, amount });
    expect(memoTotal([line(12.125)])).toBe(12.13);
    expect(memoTotal([line(10.004), line(10.004)])).toBe(20);
    expect(memoTotal([line(0.1), line(0.2)])).toBe(0.3);
  });

  it('writes a code in Arabic letters in Arial, as he typed «تويوتا 1»', () => {
    expect(html).toMatch(/class="xc c ari b"[^>]*>تويوتا 1<\/div>/u);
    expect(html).toMatch(/class="xc c cal b"[^>]*>248<\/div>/u);
  });

  it('has no company line and no department line — his tyres paper has neither', () => {
    expect(html).not.toContain('شركة إيجي كاش');
    expect(html).not.toContain('إداره الحركه');
  });

  it('prints his signers in his order, the two small «التوقيع» lines at 8pt', () => {
    inOrder(html, [
      'مشرف الصيانه',
      'النقيب / صلاح صبري علي',
      'التوقيع / (',
      'مدير إدارة  الحركة',
      'عميد / ايهاب عبد السلام سليمان',
      'التوقيع / (',
      'يرجى المراجعة والتصديق على اجمالى المصروفات',
      'لواء أ ح / جمال أحمد أبواسماعيل  -  المدير العام',
      'التوقيع  /   (',
    ]);
    expect(html.match(/font-size:8pt"><span>التوقيع \/ \(<\/span>/gu)).toHaveLength(2);
    // The review line is underlined.
    expect(html).toMatch(/class="xt ari b u"[^>]*>يرجى المراجعة/u);
  });
});

describe('his washing memo — the tyres paper with its own title', () => {
  const html = memoSheets(SAMPLE_MEMOS.wash)[0]!;

  it('is titled and banded for washing, and says «الكاوتش» nowhere', () => {
    expect(html).toContain('>مذكرة بمصروفات الغسيل  </div>');
    expect(html).toContain('>بيان بمصروفات الغسيل</div>');
    expect(html).not.toContain('الكاوتش');
    expect(html).toContain('<bdi>600</bdi>');
  });
});

describe('his maintenance memo (memo 4 — 3 lines, 5,720)', () => {
  const sheets = memoSheets(SAMPLE_MEMOS.maintenance);
  const html = sheets[0]!;

  it('prints his company, department and request line word for word', () => {
    expect(sheets).toHaveLength(1);
    expect(html).toContain('>شركة إيجي كاش للحلول النقديه</div>');
    expect(html).toContain('>إداره الحركه</div>');
    expect(html).toContain(
      '>الرجاء من سيادتكم التكرم بصرف المبالغ الأتية نظير اصلاح و تشغيل السيارات  اليومى</div>',
    );
    expect(html).toContain('>بيان بمصروفات الصيانة</div>');
    inOrder(html, ['>م<', '>البيان<', '>الاجمالى<', '>ملاحظات<']);
  });

  it('writes the lines in «General» and the totals in «0.00», twice', () => {
    for (const amount of ['5230', '40', '450']) expect(html).toContain(`<bdi>${amount}</bdi>`);
    expect(html.match(/<bdi>5720\.00<\/bdi>/gu)).toHaveLength(2);
    expect(html).toContain('>الاجمالى النهائى</div>');
    expect(html).toContain('>الاجمالى النهائى للمصروفات</div>');
  });

  it('stretches the logo across his cell: 123 × 34', () => {
    expect(html).toMatch(/<img [^>]*width:123px;height:34px;object-fit:fill/u);
  });

  it('shrinks a long «البيان» to fit its cell (Excel’s «shrink to fit»), a short one stays 11pt', () => {
    const size = (words: string): number =>
      Number(new RegExp(`font-size:([\\d.]+)pt">${words}`, 'u').exec(html)?.[1]);
    const long = size('عدد 4 اكزز كنترول');
    expect(long).toBeGreaterThanOrEqual(6);
    expect(long).toBeLessThan(11);
    expect(size('عدد 2 لمبة المانى')).toBe(11);
  });

  it('a «البيان» or «ملاحظات» too long for its cell goes onto two lines, else is cut at its edges', () => {
    const long =
      'تغيير طقم تيل فرامل امامى + خلفى + تغيير زيت + فلتر زيت + فلتر هواء + فلتر بنزين + عدد 4 بوجيه + ضبط زوايا';
    const huge = `${'كلمة '.repeat(100)}`.trim();
    const lines = SAMPLE_MEMOS.maintenance.lines.map((line, i) =>
      i === 0
        ? { ...line, statement: long, note: long }
        : i === 1
          ? { ...line, statement: huge }
          : line,
    );
    const page = memoSheets({ ...SAMPLE_MEMOS.maintenance, lines })[0]!;
    const cellOf = (start: string): string =>
      new RegExp(`<div class="xc[^"]*" style="([^"]*)">${start}`, 'u').exec(page)?.[1] ?? '';
    // Two lines in the row, each centred, as large as the row lets two lines be — not cut.
    const wrapped = cellOf('تغيير طقم');
    expect(wrapped).toContain('text-align:center');
    expect(wrapped).not.toContain('overflow:hidden');
    expect(page).toMatch(/>تغيير طقم[^<]*\n[^<]*ضبط زوايا</u);
    // Past what two lines can hold at the least: cut at the cell's own edges.
    expect(cellOf('كلمة')).toContain('overflow:hidden');
    // The rest stay exactly as before: one line, no clip.
    expect(cellOf('عدد 3 مروحة تكييف')).not.toMatch(/text-align|overflow/u);
  });

  it('places the preparer, then the director, then the general manager under his review line', () => {
    inOrder(html, [
      'رئيس قسم الصيانه',
      'المقدم / محمد حسين محمد',
      'التوقيع (',
      'مدير اداره الحركة',
      'عميد / إيهاب عبدالسلام سليمان',
      'التوقيع (',
      'يرجى المراجعة والتصديق على اجمالى المصروفات',
      'لواء أح / جمال أحمد أبواسماعيل  -  المدير العام التنفيذى  -  شركة ايجى كاش للحلول النقدية',
      'التوقيع  /   (',
    ]);
  });
});

describe('his fuel memo (memo 3 — 55 lines, 49,844)', () => {
  const sheets = memoSheets(SAMPLE_MEMOS.fuel);
  const html = sheets[0]!;

  it('is titled his way, two spaces after «داخلية», with his headers', () => {
    expect(html).toContain('>مذكرة داخلية  بمصروفات التمويل</div>');
    inOrder(html, ['>م<', '>الكود<', '>التاريخ<', '>المبلغ<', '>المأموريه<', '>ملاحظات<']);
    expect(html).toContain('>شركة إيجي كاش للحلول النقديه</div>');
  });

  it('writes his dates d/M/yyyy and his total grouped, on its grey', () => {
    expect(html).toContain('<bdi>20/9/2026</bdi>');
    expect(html).toContain('<bdi>1/9/2026</bdi>');
    expect(html).toMatch(/background:#d0cece/u);
    expect(html).toContain('<bdi>49,844</bdi>');
    expect(memoTotal(SAMPLE_FUEL_LINES)).toBe(49844);
  });

  it('shrinks the 55 lines onto one page', () => {
    expect(sheets).toHaveLength(1);
    const scale = Number(/transform:scale\(([\d.]+)\)/u.exec(html)?.[1]);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThanOrEqual(0.75);
  });

  it('signs with his accountant, his director split over two lines, his general manager', () => {
    inOrder(html, [
      '>محاسب الحركه<',
      '>الأستاذ/ عبدالرحمن محمد محمود<',
      '>التوقيع /<',
      '>مدير إدارة<',
      '>الحركة<',
      '>عميد / ايهاب<',
      '>التوقيع /  (<',
      '>السيد مدير عام الشركه<',
      '>لواء ا. ح / جمال احمد ابو إسماعيل<',
      '>التوقيع /    (<',
    ]);
    expect(html, 'the fuel paper has no review line').not.toContain('يرجى المراجعة');
  });
});

describe('a long memo runs on to more pages — Excel’s own breaks, at 100%', () => {
  const fuel = (count: number): string[] =>
    memoSheets({ ...SAMPLE_MEMOS.fuel, lines: lines(count, SAMPLE_FUEL_LINES) });

  it('fits one page down to 75%: 64 lines stay one sheet, 65 go to two', () => {
    expect(fuel(64)).toHaveLength(1);
    expect(fuel(65)).toHaveLength(2);
  });

  it('110 lines: 60 / 45 / 5 — the header on the first page, the total and names on the last', () => {
    const sheets = fuel(110);
    expect(sheets).toHaveLength(3);
    const numbers = sheets.map((sheet) => rowNumbers(sheet, 'fuel'));
    expect(numbers.map((page) => page.length)).toEqual([60, 45, 5]);
    expect(numbers[1]![0]).toBe(61);
    expect(numbers.flat()).toEqual(Array.from({ length: 110 }, (_, i) => i + 1));
    for (const [i, sheet] of sheets.entries()) {
      expect(sheet.includes('>المأموريه<'), `header on sheet ${i + 1}`).toBe(i === 0);
      expect(sheet.includes('عبدالرحمن'), `names on sheet ${i + 1}`).toBe(i === 2);
      expect(sheet.includes('#d0cece'), `total on sheet ${i + 1}`).toBe(i === 2);
      expect(sheet, 'a run-on page is drawn at 100%').not.toContain('transform:scale(');
    }
  });

  it('never leaves fewer than five rows on the last page', () => {
    for (let count = 65; count <= 200; count += 1) {
      const sheets = fuel(count);
      expect(rowNumbers(sheets.at(-1)!, 'fuel').length, String(count)).toBeGreaterThanOrEqual(5);
    }
  });

  it('runs the tyres, washing and maintenance memos on the same way', () => {
    for (const kind of ['tyres', 'wash', 'maintenance'] as const) {
      const sheets = memoSheets({
        ...SAMPLE_MEMOS[kind],
        lines: lines(60, SAMPLE_MEMOS[kind].lines),
      });
      expect(sheets.length, kind).toBeGreaterThan(1);
      const numbers = sheets.flatMap((sheet) => rowNumbers(sheet, kind));
      expect(numbers, kind).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
      expect(rowNumbers(sheets.at(-1)!, kind).length, kind).toBeGreaterThanOrEqual(5);
      // The top (logo, band) on the first page only; the total on the last only.
      sheets.forEach((sheet, i) => {
        expect(sheet.includes('<img '), `${kind} logo on sheet ${i + 1}`).toBe(i === 0);
        expect(sheet.includes('الاجمالى النهائى<'), `${kind} total on sheet ${i + 1}`).toBe(
          i === sheets.length - 1,
        );
      });
    }
  });

  it('a memo with no line yet is one page with an empty table', () => {
    for (const kind of ['tyres', 'fuel', 'maintenance', 'wash'] as const) {
      const sheets = memoSheets({ kind, lines: [], signatures: DEFAULTS[kind] });
      expect(sheets, kind).toHaveLength(1);
      expect(rowNumbers(sheets[0]!, kind), kind).toEqual([]);
    }
  });
});

describe('every memo', () => {
  const all = (['tyres', 'fuel', 'maintenance', 'wash'] as const).map((kind) => ({
    kind,
    sheets: memoSheets(SAMPLE_MEMOS[kind]),
  }));

  it('prints Latin digits only, and nothing of the app’s: no number, no name, no date', () => {
    for (const { kind, sheets } of all) {
      for (const sheet of sheets) {
        const text = textOf(sheet);
        expect(text, kind).not.toMatch(/[\u0660-\u0669]/u);
        expect(text, kind).not.toContain('مذكرة رقم');
        expect(text, kind).not.toContain('رقم');
        // Only the fuel paper prints dates — its lines’ own.
        if (kind !== 'fuel') expect(text, kind).not.toContain('2026');
      }
    }
  });

  it('carries no script, no handler, no @font-face and no @page — one sheet per string', () => {
    for (const { kind, sheets } of all) {
      for (const sheet of sheets) {
        expect(sheet, kind).not.toMatch(/<script/iu);
        expect(sheet, kind).not.toMatch(/\son[a-z]+=/u);
        expect(sheet, kind).not.toContain('@font-face');
        expect(sheet, kind).not.toContain('@page');
        expect(sheet.match(/data-paper-sheet="true"/gu), kind).toHaveLength(1);
      }
    }
  });

  it('scopes every CSS rule to its sheet — a bare `img{…}` would restyle the whole app', () => {
    const selectors = MEMO_CSS.split('}')
      .map((rule) => rule.split('{')[0]!.trim())
      .filter((selector) => selector !== '')
      .flatMap((selector) => selector.split(','));
    expect(selectors.length).toBeGreaterThan(10);
    for (const selector of selectors) expect(selector.trim()).toMatch(/^\.xm-sheet(?:[ .>]|$)/u);
    expect(MEMO_CSS).toContain('.xm-sheet img{display:block;max-width:none}');
  });
});

describe('the names a memo is signed with', () => {
  const tyres = SAMPLE_MEMOS.tyres;

  it('an endorser switched off takes his lines and the review line with him', () => {
    const html = memoSheets({
      ...tyres,
      signatures: {
        ...tyres.signatures,
        blocks: tyres.signatures.blocks.map((b) =>
          b.role === 'endorser' ? { ...b, on: false } : b,
        ),
      },
    })[0]!;
    expect(html).not.toContain('جمال أحمد');
    expect(html).not.toContain('يرجى المراجعة');
    expect(html).not.toContain('التوقيع  /   (');
    expect(html).toContain('النقيب / صلاح صبري علي');
  });

  it('an empty review line prints none', () => {
    const html = memoSheets({ ...tyres, signatures: { ...tyres.signatures, note: '' } })[0]!;
    expect(html).not.toContain('يرجى المراجعة');
    expect(html).toContain('لواء أ ح / جمال');
  });

  it('prints an edited name exactly as typed — his double spaces kept, markup escaped', () => {
    const html = memoSheets({
      ...tyres,
      signatures: {
        ...tyres.signatures,
        blocks: tyres.signatures.blocks.map((b) =>
          b.role === 'preparer' ? { ...b, name: 'النقيب  /  <b>صلاح</b>' } : b,
        ),
      },
    })[0]!;
    expect(html).toContain('>النقيب  /  &lt;b&gt;صلاح&lt;/b&gt;</div>');
    expect(html).not.toContain('<b>');
  });

  it('escapes every typed cell: the code, the mission, the statement, the note', () => {
    const evil = '<img src=x onerror=alert(1)>';
    for (const kind of ['tyres', 'fuel', 'maintenance'] as const) {
      const html = memoSheets({
        kind,
        lines: [
          { code: evil, date: '2026-09-01', amount: 1, mission: evil, statement: evil, note: evil },
        ],
        signatures: DEFAULTS[kind],
      }).join('');
      expect(html, kind).not.toContain('<img src=x');
      // A narrow cell may put it on two lines (`fitCell`) — a line break where a space was.
      expect(html, kind).toMatch(/&lt;img[ \n]src=x[ \n]onerror=alert\(1\)&gt;/u);
    }
  });
});
