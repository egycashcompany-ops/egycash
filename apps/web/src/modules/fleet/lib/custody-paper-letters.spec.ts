// His three Word letters, pinned against his own (the approved scenario): his titles, his dates,
// his request sentences word for word — spaces included — his tables, his signers, Arabic-Indic
// digits everywhere but the settle letter's Latin amounts.
import { DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES as DEFAULTS } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { TATWEEL } from './custody-paper-format';
import {
  chargeLetterSentence,
  letterSheets,
  replenishRowsOf,
  settleRowsOf,
  type LetterPaperInput,
} from './custody-paper-letters';
import { LETTER_CSS } from './custody-paper-word';
import { SAMPLE_CHARGE, SAMPLE_REPLENISH, SAMPLE_SETTLE } from './custody-paper-samples';

const TW = `<span class="tw">${TATWEEL}</span>`;

/** What a sheet reads: no styles, no tags, the entities back to their characters. */
const textOf = (html: string): string =>
  html
    .replace(/<style>[\s\S]*?<\/style>/gu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, '&');

/** The letter's request sentence: its `.body`, as text. */
const bodyOf = (html: string): string =>
  textOf(/<(?:div|p) class="body[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p)>/u.exec(html)?.[1] ?? '');

const one = (input: LetterPaperInput): string => {
  const sheets = letterSheets(input);
  expect(sheets).toHaveLength(1);
  return sheets[0]!;
};

describe('«صرف عهدة» — a charge (05/10, 200,000)', () => {
  const html = one(SAMPLE_CHARGE);

  it('is titled and dated his way: «التاريخ» at 10pt, the date in Arabic-Indic', () => {
    expect(html).toContain('<span class="wl-u">صرف عهدة</span>');
    expect(html).toContain('<span style="font-size:10pt">التاريخ</span> ٥/١٠/٢٠٢٦</p>');
  });

  it('asks in his two paragraphs: the request, then the reason — a leading «نظير» not doubled', () => {
    expect(html).toContain(
      '>برجاء التكرم من صرف مبلغ ( ٢٠٠,٠٠٠) العهده و ذلك نظير<span class="wl-br"></span> ٢٤ سياره تجديد + ٢٣ سياره مد مده .</div>',
    );
    expect(textOf(html)).not.toContain('نظير نظير');
    // Typed with or without «نظير», the letter is the same.
    expect(one({ ...SAMPLE_CHARGE, reason: '24 سياره تجديد + 23 سياره مد مده' })).toBe(html);
  });

  it('with no reason, the sentence ends at «العهده» and the second paragraph is gone', () => {
    const bare = one({ ...SAMPLE_CHARGE, reason: '   ' });
    expect(bare).toContain('>برجاء التكرم من صرف مبلغ ( ٢٠٠,٠٠٠) العهده</div>');
    expect(bare).not.toContain('و ذلك نظير');
    expect(bare).not.toContain('<span class="wl-br">');
  });

  it('closes without a comma and is signed by three — the general manager in Arial', () => {
    expect(html).toContain('>وتفضلوا بقبول فائق الاحترام</p>');
    expect(html).toContain('>الأستاذ : مصطفى حسب الله</p>');
    expect(html).toContain('>        التوقيع : (                           )</p>');
    expect(html).toMatch(/<div class="ar"><p [^>]*>لواء ا \. ح {2}: جمال أبو إسماعيل<\/p>/u);
    expect(html.match(/class="sg"/gu)).toHaveLength(3);
  });

  it('gives «نص الخطاب» the letter’s own sentence, word for word', () => {
    expect(chargeLetterSentence(SAMPLE_CHARGE)).toBe(bodyOf(html));
    expect(chargeLetterSentence(SAMPLE_CHARGE)).toBe(
      'برجاء التكرم من صرف مبلغ ( ٢٠٠,٠٠٠) العهده و ذلك نظير ٢٤ سياره تجديد + ٢٣ سياره مد مده .',
    );
    const bare = { ...SAMPLE_CHARGE, reason: '' };
    expect(chargeLetterSentence(bare)).toBe(bodyOf(one(bare)));
    expect(chargeLetterSentence(bare)).toBe('برجاء التكرم من صرف مبلغ ( ٢٠٠,٠٠٠) العهده');
  });

  it('escapes the typed reason', () => {
    const typed = one({ ...SAMPLE_CHARGE, reason: '<b>تجديد</b>' });
    expect(typed).toContain('&lt;b&gt;تجديد&lt;/b&gt;');
    expect(typed).not.toContain('<b>');
  });
});

describe('«استعاضه عهدة» — the 29/09 replenishment (81,908)', () => {
  const html = one(SAMPLE_REPLENISH);

  it('is dated and titled his way, greeting twice', () => {
    expect(html).toContain('>التاريخ٢٩/ ٠٩ / ٢٠٢٦</p>');
    expect(html).toContain('<span class="wl-u">استعاضه عهدة</span>');
    expect(html.match(/>تحية طيبة وبعد،</gu)).toHaveLength(2);
  });

  it('asks in his sentence, word for word — the bracket figure his 100,000', () => {
    expect(html).toContain(
      `> برجاء التكرم من استعاضه  مبلغ (٨١,٩٠٨) من العهده حيث ان عهده اداره الحركه  ( ١٠٠,٠٠٠) عن الفتره من ٠١${TW}٠٩${TW}٢٠٢٦ الى الفتره ٣٠${TW}٠٩${TW}٢٠٢٦ وذلك نظير وقود و كاوتش و صيانه.</p>`,
    );
  });

  it('tables the kinds in his order with Arabic-Indic figures, and his «الاجمالي»', () => {
    const rows = [
      ...html.matchAll(/<tr [^>]*><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/gu),
    ].map((m) => [m[1], m[2], m[3]]);
    expect(rows).toEqual([
      ['م', 'المذكره', 'القيمه'],
      ['١', 'كاوتش', '٢,٦٥٠'],
      ['٢', 'وقود', '٤٩,٨٤٤'],
      ['٣', 'صيانه', '٢٩,٤١٤'],
      ['الاجمالي', '', '٨١,٩٠٨'],
    ]);
  });

  it('is signed «الاستاذ» without a hamza, as his replenish letter is, with the comma closing', () => {
    expect(html).toContain('>الاستاذ : مصطفى حسب الله</p>');
    expect(html).toContain('>وتفضلوا بقبول فائق الاحترام،</p>');
    expect(html).toContain('لواء ا . ح');
  });

  it('prints the letter’s own date where no period was given', () => {
    const bare = one({ ...SAMPLE_REPLENISH, from: null, to: null });
    expect(bare).toContain(`من ٢٩${TW}٠٩${TW}٢٠٢٦ الى الفتره ٢٩${TW}٠٩${TW}٢٠٢٦`);
  });
});

describe('«تسويه عهدة» — the 05/10 settlement (124,139.46)', () => {
  const html = one(SAMPLE_SETTLE);

  it('is dated and titled his way, a Word size smaller than the replenishment', () => {
    expect(html).toContain('>التاريخ ٥ / ١٠ / ٢٠٢٦</p>');
    expect(html).toContain('<span class="wl-u">تسويه عهدة</span>');
    expect(html).toMatch(/<p class="body wl-c" style="font-size:12pt/u);
  });

  it('asks in his sentence — piastres after «٫», the day unpadded, no full stop', () => {
    expect(bodyOf(html)).toBe(
      ` برجاء التكرم من تسويه  مبلغ (١٢٤,١٣٩٫٤٦) من العهده (٢٩٩,٤٠٠) حيث تم صرف مصروفات تراخيص سيارات عن الفتره من ١${TATWEEL}٠٩${TATWEEL}٢٠٢٦ الى الفتره ٣٠${TATWEEL}٠٩${TATWEEL}٢٠٢٦`,
    );
  });

  it('tables his licensing memos with LATIN amounts, the labels bold in Arabic-Indic', () => {
    expect(html).toContain('<td class="n4">١</td><td>تجديد ٥ سياره</td><td>39,732.19</td>');
    expect(html).toContain('<td>الاجمالى</td><td></td><td>124,139.46</td>');
    const extension = one({
      ...SAMPLE_SETTLE,
      rows: [{ part: 'extension', cars: 23, amount: 5000 }],
      amount: 5000,
    });
    expect(extension).toContain('<td>مد مده ٢٣ سياره</td><td>5,000.00</td>');
  });

  it('leaves the general manager off, as his settle letter does', () => {
    expect(html).not.toContain('لواء');
    expect(html).not.toContain('<div class="ar">');
    expect(html.match(/class="sg"/gu)).toHaveLength(2);
  });
});

describe('a letter past one sheet', () => {
  const textOfAll = (sheets: readonly string[]): string[] => sheets.map(textOf);

  it('settle: the table runs on — heads again on each sheet, every row once, in order; the total and the signers on the last', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      part: 'renewal' as const,
      cars: 5,
      amount: 1000 + i,
    }));
    const sheets = letterSheets({ ...SAMPLE_SETTLE, rows, amount: 30435 });
    expect(sheets.length).toBe(2);
    for (const html of sheets) {
      expect(html).toContain('<div class="wl-frame"></div>');
      expect(html).toContain('<img class="wl-logo"');
      expect(html.match(/<td class="n4">م<\/td>/gu)).toHaveLength(1);
    }
    const numbers = sheets.flatMap((html) =>
      [...html.matchAll(/<tr style="height:16\.1pt"><td class="n4">([^<]+)<\/td>/gu)].map(
        (m) => m[1],
      ),
    );
    expect(numbers).toEqual(rows.map((_, i) => (i + 1).toLocaleString('ar-EG')));
    const [first, last] = textOfAll(sheets);
    expect(first).toContain('برجاء التكرم');
    expect(first).not.toContain('التوقيع');
    expect(first).not.toContain('الاجمالى');
    expect(last).not.toContain('برجاء التكرم');
    expect(last).toContain('30,435.00');
    expect(last!.match(/التوقيع/gu)).toHaveLength(2);
    // At least two rows go over with the total — never the total alone.
    expect(
      sheets[1]!.match(/<tr style="height:16\.1pt"><td class="n4">/gu)!.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('settle: as many rows as fit stay on his one sheet', () => {
    const rows = Array.from({ length: 18 }, () => ({
      part: 'renewal' as const,
      cars: 5,
      amount: 1,
    }));
    expect(letterSheets({ ...SAMPLE_SETTLE, rows, amount: 18 })).toHaveLength(1);
  });

  it('charge: a reason too long for one sheet sends the closing and the signers, together, to a second', () => {
    const reason = 'تجديد تراخيص سيارات الفرع الرئيسي ومد مدة سيارات فرع الاسكندرية + '
      .repeat(8)
      .trim();
    const sheets = letterSheets({ ...SAMPLE_CHARGE, reason });
    expect(sheets).toHaveLength(2);
    const [first, second] = textOfAll(sheets);
    expect(bodyOf(sheets[0]!)).toContain('و ذلك نظير');
    expect(first).not.toContain('التوقيع');
    expect(second).toContain('والأمر مفوض لسيادتكم');
    expect(second!.match(/التوقيع/gu)).toHaveLength(3);
  });
});

describe('every letter', () => {
  const all = { charge: SAMPLE_CHARGE, replenish: SAMPLE_REPLENISH, settle: SAMPLE_SETTLE };

  it('is one sheet with his letterhead and frame', () => {
    for (const [kind, input] of Object.entries(all)) {
      const html = one(input);
      expect(html, kind).toContain('<img class="wl-logo" src="data:image/');
      expect(html, kind).toContain(
        '<div>إيجي كاش للحلول النقدية</div><div class="l2">إدارة الحركة</div>',
      );
      expect(html, kind).toContain('<div class="wl-frame"></div>');
      expect(html.match(/data-paper-sheet="true"/gu), kind).toHaveLength(1);
    }
  });

  it('prints Arabic-Indic digits only — but for the settle letter’s Latin amounts', () => {
    for (const [kind, input] of Object.entries(all)) {
      const text = textOf(one(input)).replace(/\d{1,3}(?:,\d{3})*\.\d{2}/gu, '');
      expect(text, kind).not.toMatch(/[0-9]/u);
    }
  });

  it('carries no script, no handler, no @font-face and no @page', () => {
    for (const [kind, input] of Object.entries(all)) {
      const html = one(input);
      expect(html, kind).not.toMatch(/<script/iu);
      expect(html, kind).not.toMatch(/\son[a-z]+=/u);
      expect(html, kind).not.toContain('@font-face');
      expect(html, kind).not.toContain('@page');
    }
  });

  it('scopes every CSS rule to its sheet', () => {
    const selectors = LETTER_CSS.split('}')
      .map((rule) => rule.split('{')[0]!.trim())
      .filter((selector) => selector !== '')
      .flatMap((selector) => selector.split(','));
    expect(selectors.length).toBeGreaterThan(10);
    for (const selector of selectors) expect(selector.trim()).toMatch(/^\.wl-sheet(?:[ .>:]|$)/u);
  });

  it('a signer switched off prints nothing of his', () => {
    const html = one({
      ...SAMPLE_REPLENISH,
      signatures: {
        ...DEFAULTS.replenish,
        blocks: DEFAULTS.replenish.blocks.map((b) =>
          b.role === 'finance' ? { ...b, on: false } : b,
        ),
      },
    });
    expect(html).not.toContain('مصطفى');
    expect(html.match(/class="sg"/gu)).toHaveLength(2);
  });
});

describe('the letters’ rows, from what was replenished or settled', () => {
  it('replenish: one row per kind in his order, the memos of a kind together, none for nothing', () => {
    expect(
      replenishRowsOf([
        { kind: 'maintenance', total: 5720 },
        { kind: 'tyres', total: 1690 },
        { kind: 'fuel', total: 49844 },
        { kind: 'tyres', total: 960 },
        { kind: 'maintenance', total: 23694 },
        { kind: 'wash', total: 0 },
      ]),
    ).toEqual([
      { kind: 'tyres', amount: 2650 },
      { kind: 'fuel', amount: 49844 },
      { kind: 'maintenance', amount: 29414 },
    ]);
    expect(
      replenishRowsOf([
        { kind: 'wash', total: 0.1 },
        { kind: 'wash', total: 0.2 },
      ]),
    ).toEqual([{ kind: 'wash', amount: 0.3 }]);
  });

  it('settle: one row per licensing memo, oldest first, a record’s renewal before its extension', () => {
    expect(
      settleRowsOf([
        { part: 'extension', cars: 23, amount: 3, date: '2026-09-10' },
        { part: 'renewal', cars: 5, amount: 2, date: '2026-09-10' },
        { part: 'renewal', cars: 4, amount: 1, date: '2026-09-02' },
      ]),
    ).toEqual([
      { part: 'renewal', cars: 4, amount: 1 },
      { part: 'renewal', cars: 5, amount: 2 },
      { part: 'extension', cars: 23, amount: 3 },
    ]);
  });
});
