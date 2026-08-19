// WHY THIS EXISTS. Money now READS grouped (1,000) but was still TYPED ungrouped: the field
// showed 1000 while the table beside it showed 1,000. Grouping it in place is not a formatting
// change — `<input type="number">` cannot hold "1,000" at all (the value must parse as a number,
// so a comma blanks the field), which is why the whole control had to become a text input that
// carries the rules itself.
//
// Everything the control does lives here, so it can be proven without a DOM. The caret cases are
// the ones that matter: a grouped field that throws the caret to the end of the line on every
// keystroke is unusable for the amounts these screens exist to record.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  caretAfterGrouping,
  groupAmount,
  sanitizeAmount,
  separatorDelete,
  typedBeforeCaret,
} from './money-input';

describe('what the field submits', () => {
  it('drops the separators it renders, so 1,000 submits as 1000', () => {
    expect(sanitizeAmount('1,000')).toBe('1000');
  });

  it('reads an amount typed on an Arabic keyboard as the same number', () => {
    expect(sanitizeAmount('١٠٠٠')).toBe('1000'); // Arabic-Indic digits
    expect(sanitizeAmount('١٬٠٠٠٫٥')).toBe('1000.5'); // with ٬ grouping and ٫ decimal
    expect(sanitizeAmount('۱۲۳')).toBe('123'); // extended Arabic-Indic
  });

  it('refuses a minus sign — every money field in the system is min={0}', () => {
    expect(sanitizeAmount('-500')).toBe('500');
  });

  it('keeps only the first decimal point', () => {
    expect(sanitizeAmount('1.2.3')).toBe('1.23');
  });

  it('caps the decimals at what the contract records, so the API cannot refuse what was typed', () => {
    expect(sanitizeAmount('1.999')).toBe('1.99');
  });

  it('preserves a half-typed decimal instead of tidying it away mid-keystroke', () => {
    expect(sanitizeAmount('1000.')).toBe('1000.');
  });

  it('discards anything that is not part of an amount', () => {
    expect(sanitizeAmount('abc')).toBe('');
    expect(sanitizeAmount('1 000 EGP')).toBe('1000');
    expect(sanitizeAmount('')).toBe('');
  });
});

describe('what the field shows', () => {
  it('groups the reported figure — type 1000, read 1,000', () => {
    expect(groupAmount('1000')).toBe('1,000');
  });

  it('groups every triple', () => {
    expect(groupAmount('1234567')).toBe('1,234,567');
  });

  it('groups only the whole part', () => {
    expect(groupAmount('1000.5')).toBe('1,000.5');
    expect(groupAmount('1000.')).toBe('1,000.');
  });

  it('leaves a figure below a thousand, and an empty field, alone', () => {
    expect(groupAmount('999')).toBe('999');
    expect(groupAmount('')).toBe('');
  });

  it('is stable: showing an already-canonical value never changes it again', () => {
    for (const raw of ['1000', '1000.5', '999', '', '1234567.25']) {
      expect(sanitizeAmount(groupAmount(raw))).toBe(raw);
    }
  });
});

describe('the caret stays where the typing is', () => {
  // The case that makes or breaks a grouped field: a comma APPEARS to the left of the caret as
  // the fourth digit lands. Keeping the raw offset would leave the caret one place behind.
  it('lands after the digit just typed, when grouping shifts the text', () => {
    const typed = '1000'; // caret at 4, right after the last 0
    const shown = groupAmount(sanitizeAmount(typed)); // '1,000'
    expect(caretAfterGrouping(shown, typedBeforeCaret(typed, 4))).toBe(5);
  });

  it('stays put when editing in the middle of a grouped figure', () => {
    // '1,000' with the caret after the '1'; the user types '2' → '12,000', caret after the 2.
    const typed = '12,000';
    expect(caretAfterGrouping(groupAmount(sanitizeAmount(typed)), typedBeforeCaret(typed, 2))).toBe(2);
  });

  it('counts Arabic-Indic digits as digits when placing the caret', () => {
    const typed = '١٠٠٠';
    expect(typedBeforeCaret(typed, 4)).toBe(4);
  });

  it('goes to the start of an empty field, and to the end when asked past it', () => {
    expect(caretAfterGrouping('', 0)).toBe(0);
    expect(caretAfterGrouping('1,000', 99)).toBe(5);
  });
});

describe('deleting a separator deletes the digit it stands in front of', () => {
  // Left to the browser, backspacing the comma in 1,000 removes a character the reformat puts
  // straight back: the field flickers and nothing happens, at the position people edit most.
  it('backspace onto a comma removes the digit before it', () => {
    expect(separatorDelete('1,000', 2, 'Backspace')).toEqual({ raw: '000', caret: 0 });
  });

  it('delete onto a comma removes the digit after it', () => {
    expect(separatorDelete('1,000', 1, 'Delete')).toEqual({ raw: '100', caret: 1 });
  });

  it('leaves an ordinary keystroke to the browser', () => {
    expect(separatorDelete('1,000', 5, 'Backspace')).toBeNull();
    expect(separatorDelete('1000', 2, 'Delete')).toBeNull();
  });
});

describe('no money field is typed as a bare number input', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full);
      return full.endsWith('.tsx') ? [full] : [];
    });

  /**
   * What a `type="number"` element is FOR: the state it is bound to, its own labelling, and the
   * `<Field label=…>` that introduces it. Deliberately narrow — a window of neighbouring lines
   * read the salary field above `probationMonths` and called a count of months money.
   */
  const subjectOf = (lines: string[], at: number): string => {
    let open = at;
    while (open > 0 && !/<[Ii]nput\b/.test(lines[open] ?? '')) open -= 1;
    let close = at;
    while (close < lines.length && !(lines[close] ?? '').includes('/>')) close += 1;
    const element = lines.slice(open, close + 1).join('\n');
    // The introducing label, if one is within reach and no other control sits between.
    const above = lines.slice(Math.max(0, open - 5), open);
    const label = [...above].reverse().find((line) => line.includes('<Field'));
    const blocked = above.some((line) => line.includes('</Field>'));
    return element + (label === undefined || blocked ? '' : `\n${label}`);
  };

  it('every amount, cost, salary and price input is a MoneyInput', () => {
    const MONEY = /\b(amount|cost|salary|price|fee|fine|allowance)/i;
    const offenders: string[] = [];
    for (const file of walk(root)) {
      // This component's own doc comment names `type="number"` to explain why it cannot be one.
      if (file.endsWith('MoneyInput.tsx')) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!line.includes('type="number"') || line.trimStart().startsWith('//')) return;
        if (MONEY.test(subjectOf(lines, index))) offenders.push(`${file.slice(root.length)}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
