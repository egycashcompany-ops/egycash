import { describe, expect, it } from 'vitest';
import {
  applyInputChange,
  applyInputRule,
  insertedText,
  inputRuleReason,
  normalizeForRule,
} from './input-rules';

describe('numbers only', () => {
  it('takes Arabic-Indic digits as the same number', () => {
    expect(applyInputRule('integer', '٤٨٢١٣')).toEqual({ value: '48213', reason: null });
  });

  it('takes a pasted grouped number as the number', () => {
    expect(applyInputRule('integer', '48,213').value).toBe('48213');
    expect(applyInputRule('integer', '٤٨٬٢١٣').value).toBe('48213');
  });

  it('refuses text, with the reason', () => {
    expect(applyInputRule('integer', 'KM 48,213')).toEqual({ value: null, reason: 'numbersOnly' });
    expect(applyInputRule('integer', '48213 كم').reason).toBe('numbersOnly');
    // No sign, no exponent — what `type="number"` used to let through.
    expect(applyInputRule('integer', '-5').reason).toBe('numbersOnly');
    expect(applyInputRule('integer', '1e5').reason).toBe('numbersOnly');
  });

  it('keeps a card number’s spaces and turns its dashes into spaces', () => {
    expect(applyInputRule('digits', '7045-1120-0098-2231').value).toBe('7045 1120 0098 2231');
    expect(applyInputRule('digits', '7045 ABCD').reason).toBe('numbersOnly');
  });

  it('reads a phone number without its separators, and keeps a leading +', () => {
    expect(applyInputRule('phone', '0100 123-4567').value).toBe('01001234567');
    expect(applyInputRule('phone', '+201001234567').value).toBe('+201001234567');
    expect(applyInputRule('phone', '0100 call me').reason).toBe('numbersOnly');
  });

  it('a decimal takes one point, an Arabic one too', () => {
    expect(applyInputRule('decimal', '1,250.50').value).toBe('1250.50');
    expect(applyInputRule('decimal', '١٢٥٠٫٥').value).toBe('1250.5');
    expect(applyInputRule('decimal', '12 جنيه').reason).toBe('numbersOnly');
  });
});

describe('Arabic only / English only', () => {
  it('Arabic refuses Latin letters and keeps digits and punctuation', () => {
    expect(inputRuleReason('arabic', 'مرسيدس اسبرانتر 515')).toBeNull();
    expect(inputRuleReason('arabic', 'فلتر - زيت.')).toBeNull();
    expect(inputRuleReason('arabic', 'فلتر oil')).toBe('arabicOnly');
  });

  it('English refuses Arabic letters, and Arabic digits are only digits', () => {
    expect(inputRuleReason('english', 'Oil filter 2')).toBeNull();
    expect(inputRuleReason('english', normalizeForRule('english', 'A٦٦٠٠١٧'))).toBeNull();
    expect(normalizeForRule('english', 'A٦٦٠٠١٧')).toBe('A660017');
    expect(inputRuleReason('english', 'فلتر')).toBe('englishOnly');
  });

  it('a plate is Arabic letters and digits', () => {
    expect(inputRuleReason('plate', 'ج ك ق 4719')).toBeNull();
    expect(inputRuleReason('plate', 'ABC 123')).toBe('plateOnly');
  });
});

describe('an edit to a value saved before the rule existed', () => {
  it('names what an edit added', () => {
    expect(insertedText('1250', '12750')).toBe('7');
    expect(insertedText('abc', 'ab')).toBe('');
    expect(insertedText('', 'paste')).toBe('paste');
  });

  it('a value that keeps the rule is checked whole, as before', () => {
    expect(applyInputChange('integer', '12', '12x')).toEqual({
      value: null,
      reason: 'numbersOnly',
    });
    expect(applyInputChange('integer', '12', '123')).toEqual({ value: '123', reason: null });
  });

  it('an old value that breaks it can still be corrected — never added to', () => {
    // A chassis saved in Arabic letters: deleting from it and adding Latin to it both go through…
    expect(applyInputChange('english', 'شاسيه A1', 'شاسيه A')).toEqual({
      value: 'شاسيه A',
      reason: null,
    });
    expect(applyInputChange('english', 'شاسيه A1', 'شاسيه A12').reason).toBeNull();
    // …but more Arabic is refused.
    expect(applyInputChange('english', 'شاسيه A1', 'شاسيه بA1')).toEqual({
      value: null,
      reason: 'englishOnly',
    });
  });
});
