// WHY THIS EXISTS. Money read wrong on every Arabic screen. `ar-EG` renders 1000 as ١٬٠٠٠ —
// Arabic-Indic digits grouped with U+066C, a mark so light that in most UI fonts the figure looks
// like ١٠٠٠, an unseparated four-digit number. On a cash-transfer desk the amount IS the record.
//
// The legacy screens never showed a tabular amount that way: every one was grouped with an ASCII
// comma (`replace(/\B(?=(\d{3})+(?!\d))/g, ',')` — main_ops.ejs:874 and 41 more sites, plus
// mohsana.ejs). Arabic-Indic appeared only in the spelled-out total on a printed receipt. So this
// is the legacy reading restored, not a new house style.
//
// The second half of the defect: six Operations amounts and three IT costs were formatted with
// `formatNumber`, the COUNTS formatter, because neither carries an ISO currency code that
// `formatMoney` could use. The source guard below is what stops that reaching for the wrong
// helper again.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatAmount, formatMoney, formatMoneyParts, formatNumber } from './format';

describe('money groups, in ASCII digits, in both locales', () => {
  it('renders the reported figure as 1,000 — not 1000, and not ١٬٠٠٠', () => {
    expect(formatAmount(1000, 'ar')).toBe('1,000');
    expect(formatAmount(1000, 'en')).toBe('1,000');
  });

  it('groups every triple as the amount grows', () => {
    expect(formatAmount(1234567, 'ar')).toBe('1,234,567');
    expect(formatAmount(1234567, 'en')).toBe('1,234,567');
  });

  it('leaves a figure below a thousand ungrouped', () => {
    expect(formatAmount(250, 'ar')).toBe('250');
  });

  it('shows decimals only when the value has them — legacy printed 1,000, never 1,000.00', () => {
    expect(formatAmount(1000.5, 'ar')).toBe('1,000.5');
    expect(formatAmount(1000, 'ar')).not.toContain('.');
  });

  it('carries no Arabic-Indic digit and no U+066C separator in Arabic', () => {
    const arabic = formatAmount(1234567.5, 'ar');
    expect(arabic).not.toMatch(/[٠-٩]/); // Arabic-Indic digits
    expect(arabic).not.toContain('٬'); // Arabic thousands separator
    expect(arabic).not.toContain('٫'); // Arabic decimal separator
  });

  it('is null-safe, like every other formatter here', () => {
    expect(formatAmount(null, 'ar')).toBe('—');
    expect(formatAmount(undefined, 'en')).toBe('—');
  });

  it('formatMoney groups in ASCII too, and keeps the Arabic currency symbol', () => {
    const arabic = formatMoney(1000, 'EGP', 'ar');
    expect(arabic).toContain('1,000');
    expect(arabic).not.toMatch(/[٠-٩]/);
    // The currency itself stays localized — only the numbering system was pinned.
    expect(arabic).toContain('ج.م');
  });
});

describe('counts are NOT money and keep the reader’s own digits', () => {
  it('leaves formatNumber on the Arabic numbering system', () => {
    // Deliberate: counts are small, they are not the record, and legacy left them alone. If this
    // ever changes it must be a decision, not a side effect of a money fix.
    expect(formatNumber(1000, 'ar')).toMatch(/[٠-٩]/);
    expect(formatNumber(1000, 'en')).toBe('1,000');
  });
});

describe('no money field reaches the counts formatter', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full);
      return full.endsWith('.tsx') ? [full] : [];
    });

  // Names that are money wherever they appear. `total` alone is not on the list: `totalItems`,
  // `totalPages` and `totalCount` are counts, and the guard must not cry wolf.
  const MONEY = /formatNumber\(\s*[^)]*\b(amount|cost|salary|price|fee|fine|netPay|gross)[A-Za-z]*\b/i;

  it('every amount, cost, salary and price is formatted as money', () => {
    const offenders = walk(root)
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, i) => ({ file: file.slice(root.length), line: i + 1, text: line.trim() }))
          .filter((l) => MONEY.test(l.text)),
      )
      .map((l) => `${l.file}:${l.line}  ${l.text}`);
    expect(offenders).toEqual([]);
  });
});

describe('a sum of money split for a figure tile', () => {
  // «شكلها بايظ الإحصائيات»: the tile sets the figure in a monospace and the currency in the
  // page's own type. The two halves together must be exactly what `formatMoney` writes.
  it('gives the grouped Latin figure and the currency apart, in both locales', () => {
    expect(formatMoneyParts(245890, 'EGP', 'ar').figure).toBe('245,890.00');
    expect(formatMoneyParts(245890, 'EGP', 'en').figure).toBe('245,890.00');
    expect(formatMoneyParts(0, 'EGP', 'ar').figure).toBe('0.00');
    for (const locale of ['ar', 'en'] as const) {
      const { figure, currency } = formatMoneyParts(4200, 'EGP', locale);
      expect(currency, locale).not.toBe('');
      expect(figure, locale).not.toContain(currency);
      expect(formatMoney(4200, 'EGP', locale), locale).toContain(currency);
    }
  });

  it('keeps the minus sign of a negative sum on the figure', () => {
    expect(formatMoneyParts(-1500, 'EGP', 'ar').figure).toBe('-1,500.00');
  });
});
