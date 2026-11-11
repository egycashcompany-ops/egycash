// The catalogs' search box matches the TEXT typed, never a pattern built from it — folded the way
// the API's own Arabic search folds, so a spelling variant finds the row instead of duplicating it.
import { describe, expect, it } from 'vitest';
import { normalizeArabic } from '../hr/shared/arabic';
import { containsText, escapeRegExp } from './catalog-search';

const matches = (search: string, value: string): boolean => {
  const { $regex, $options } = containsText(search);
  return new RegExp($regex, $options).test(value);
};

/** The whole value, not a part of it — for cases where "contains" would hide a wrong answer. */
const matchesWhole = (search: string, value: string): boolean =>
  new RegExp(`^(?:${containsText(search).$regex})$`, containsText(search).$options).test(value);

describe('catalog search', () => {
  // The failure this exists for: an unbalanced bracket is not a valid pattern, and Mongo answered
  // the whole request with an error.
  it('accepts text that is not a valid pattern', () => {
    expect(() => new RegExp(containsText('فرع (المعادي').$regex)).not.toThrow();
    expect(matches('فرع (المعادي', 'فرع (المعادي) الرئيسي')).toBe(true);
  });

  it('matches regex syntax literally, not as syntax', () => {
    expect(matches('a.c', 'abc')).toBe(false);
    expect(matches('a.c', 'xa.cx')).toBe(true);
    expect(matches('1+1', '11')).toBe(false);
    expect(matches('1+1', '1+1')).toBe(true);
    expect(matches('.*', 'anything')).toBe(false);
  });

  it('still matches anywhere and ignores case', () => {
    expect(matches('cib', 'CIB — Zamalek')).toBe(true);
    expect(matches('ZAMALEK', 'cib zamalek')).toBe(true);
    expect(matches('cib', 'cxb')).toBe(false);
    expect(matches('مصر', 'بنك مصر')).toBe(true);
    expect(containsText('cib').$options).toBe('i');
  });

  it('escapes every character RegExp treats as syntax', () => {
    const syntax = '.*+?^${}()|[]\\';
    expect(new RegExp(`^${escapeRegExp(syntax)}$`).test(syntax)).toBe(true);
  });
});

describe('catalog search — Arabic folded as normalizeArabic folds it', () => {
  // The incident: «الاسكندريه» typed, «الإسكندرية» stored, nothing found — and the shipment form
  // offered to add the typed spelling as a new branch.
  it('finds a branch whatever hamza or taa marbuta the operator typed', () => {
    expect(matches('الاسكندريه', 'فرع الإسكندرية')).toBe(true);
    expect(matches('اسكندرية', 'فرع الإسكندرية')).toBe(true);
    expect(matches('الإسكندرية', 'فرع الاسكندريه')).toBe(true);
  });

  it('folds every hamza-carrier alef to the bare alef — «أ إ آ ٱ → ا», either way round', () => {
    for (const typed of ['احمد', 'أحمد', 'إحمد', 'آحمد', 'ٱحمد']) {
      for (const stored of ['احمد', 'أحمد', 'إحمد', 'آحمد', 'ٱحمد']) {
        expect(matches(typed, stored), `${typed} → ${stored}`).toBe(true);
      }
    }
  });

  it('folds alef maqsura and hamza-on-yaa to yaa — «ى ئ → ي»', () => {
    expect(matches('مستشفي', 'مستشفى الجلاء')).toBe(true);
    expect(matches('مستشفى', 'مستشفي الجلاء')).toBe(true);
    expect(matches('الرييسي', 'الفرع الرئيسي')).toBe(true);
    // ى and ئ fold to the SAME letter, so they find each other too, exactly as normalizeArabic.
    expect(matches('ى', 'ئ')).toBe(true);
  });

  it('folds taa marbuta to haa — «ة → ه»', () => {
    expect(matches('القاهره', 'بنك القاهرة')).toBe(true);
    expect(matches('القاهرة', 'بنك القاهره')).toBe(true);
  });

  it('folds hamza-on-waw to waw — «ؤ → و»', () => {
    expect(matches('مسوول', 'المسؤول')).toBe(true);
    expect(matches('مسؤول', 'المسوول')).toBe(true);
  });

  it('ignores tashkeel and tatweel on either side', () => {
    expect(matches('مصر', 'بنك مِصْر')).toBe(true); // stored with tashkeel
    expect(matches('مصر', 'بنك مـــصـر')).toBe(true); // stored with tatweel
    expect(matches('مُصر', 'بنك مصر')).toBe(true); // typed with tashkeel
    expect(matches('مصـر', 'بنك مصر')).toBe(true); // typed with tatweel
    // Typed marks alone fold to nothing, which is no filter — as an empty search box is.
    expect(containsText('ـًّ').$regex).toBe('');
  });

  it('keeps regex syntax literal beside folded letters', () => {
    expect(matches('(الإسكندرية)', 'فرع (الاسكندريه) 2')).toBe(true);
    expect(matches('ا.ه', 'ابه')).toBe(false);
    expect(matches('ا.ه', 'أ.ة')).toBe(true);
    expect(matches('ة*', 'ههه')).toBe(false);
  });

  it('does not fold what normalizeArabic keeps apart', () => {
    expect(matches('ح', 'ه')).toBe(false);
    expect(matches('ل', 'ا')).toBe(false);
    expect(matches('ک', 'ك')).toBe(false); // Persian keheh is not folded there, so not here
  });

  // NFKC's canonical half, which the header comment says needs no mirroring: a hamza or madda
  // typed as its own mark after the bare letter composes to the letter normalizeArabic folds.
  it('finds a composed hamza letter from its decomposed spelling, and back', () => {
    const spellings: readonly (readonly [string, string])[] = [
      ['أحمد', 'أحمد'],
      ['إحسان', 'إحسان'],
      ['آمال', 'آمال'],
      ['مسؤول', 'مسؤول'],
      ['رئيس', 'رئيس'],
    ];
    for (const [composed, decomposed] of spellings) {
      expect(normalizeArabic(composed)).toBe(normalizeArabic(decomposed));
      expect(matchesWhole(composed, decomposed), `${composed} → decomposed`).toBe(true);
      expect(matchesWhole(decomposed, composed), `decomposed → ${composed}`).toBe(true);
    }
  });

  // mongod refuses a pattern past 16 KB, and the API can only answer that with a 500 — the very
  // failure this file exists to end. The fold makes each letter ~33 bytes, so a paste of a few
  // hundred letters used to reach it.
  it("keeps the pattern far under mongod's 16 KB however long the paste", () => {
    const worst = containsText('أ'.repeat(50_000)).$regex; // a fold class for every letter
    expect(Buffer.byteLength(worst)).toBeLessThan(10_000);
    expect(Buffer.byteLength(containsText('.('.repeat(50_000)).$regex)).toBeLessThan(10_000);
    // The cut counts letters after the marks are stripped, and never halves a surrogate pair.
    expect(containsText('ًا'.repeat(300)).$regex).toBe(containsText('ا'.repeat(200)).$regex);
    expect(containsText('💰'.repeat(300)).$regex).toBe(containsText('💰'.repeat(200)).$regex);
  });

  it('matches a long paste on its first 200 letters — wider, never emptier', () => {
    const name = `فرع ${'ا'.repeat(196)}`; // 200 letters
    expect(matches(`${name} وما بعده`, `${name} القديم`)).toBe(true);
    expect(matches(`فرع ${'ب'.repeat(196)} وما بعده`, `${name} القديم`)).toBe(false);
  });

  it('never splits a character outside the BMP with a marks run', () => {
    expect(containsText('💰').$regex).toBe('💰');
    expect(matches('💰 1', 'خزنة 💰 1')).toBe(true);
  });

  // ReDoS: one class-with-star between single-character atoms, nothing nested, no alternation.
  it('builds atoms joined by one marks run, and nothing else', () => {
    const joiner = containsText('ab').$regex.slice(1, -1);
    expect(joiner).toMatch(/^\[[^\]]+\]\*$/);
    expect(containsText('أ.ة(').$regex).toBe(['[اأإآٱ]', '\\.', '[هة]', '\\('].join(joiner));
    // A long run of marks and a near miss is answered at once, not after a backtracking storm.
    const started = Date.now();
    expect(matches('اببببب', `ا${'ًـ'.repeat(20_000)}ببببx`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  // The parity pin. If normalizeArabic gains or loses a fold, this fails until the catalogs follow.
  describe('parity with normalizeArabic over the whole Arabic block (U+0600–U+06FF)', () => {
    const block = Array.from({ length: 0x100 }, (_, i) => String.fromCharCode(0x0600 + i));
    const hex = (c: string): string => `U+${c.charCodeAt(0).toString(16).toUpperCase()}`;
    const marks = block.filter((c) => normalizeArabic(c) === '');
    // What normalizeArabic maps to ONE letter. U+0675–U+0678 expand to two under NFKC (a letter
    // and a high hamza), which no single class can mirror; no Egyptian keyboard types them.
    const letters = block.filter((c) => [...normalizeArabic(c)].length === 1);

    it('treats two letters as one exactly when normalizeArabic does', () => {
      const wrong: string[] = [];
      for (const typed of letters) {
        for (const stored of letters) {
          const same = normalizeArabic(typed) === normalizeArabic(stored);
          if (matchesWhole(typed, stored) !== same) wrong.push(`${hex(typed)}/${hex(stored)}`);
        }
      }
      expect(wrong).toEqual([]);
    });

    it('lets exactly the marks it strips sit between letters, and strips them from the typed text', () => {
      expect(marks.length).toBeGreaterThan(0);
      const missed = marks.filter(
        (m) => !matchesWhole('مصر', `م${m}صر`) || !matchesWhole(`م${m}صر`, 'مصر'),
      );
      expect(missed.map(hex)).toEqual([]);
      const extra = letters.filter((c) => matchesWhole('مصر', `م${c}صر`));
      expect(extra.map(hex)).toEqual([]);
    });
  });
});
