// How the supplier screens show a supplier, proven rule by rule (design §6.8, §11.5): a phone is
// never whole in the register, in any script's digits; a paper's scan state decides whether it opens
// and what it wears; the record reads itself again with backoff only while a paper is still being
// scanned, the backoff starting at the paper; a full list is twenty; a size reads in the reader's
// digits.
import { describe, expect, it } from 'vitest';
import { paper, supplier } from '../supplier-fixtures';
import {
  maskPhone,
  nextScanWait,
  paperSize,
  paperState,
  papersFull,
  scanRecheckDelay,
  supplierCategoryNames,
  type ScanWait,
} from './supplier-view';

describe('a phone in the register', () => {
  it('keeps the first three digits and the last four, the rest starred — `298*******4567`', () => {
    expect(maskPhone('01012345678')).toBe('010****5678');
    expect(maskPhone('29801234564567')).toBe('298*******4567');
  });

  it('keeps its spaces, dashes and plus, so it still reads as the number it is', () => {
    expect(maskPhone('+20 10 1234 5678')).toBe('+20 1* **** 5678');
    expect(maskPhone(' 02-2345-6789 ')).toBe('02-2***-6789');
  });

  it('masks a phone typed in Arabic-Indic or Persian digits as it masks one in Latin digits', () => {
    // The contract stores a phone as typed, and an Arabic keyboard types «٠١٠…».
    expect(maskPhone('٠١٠١٢٣٤٥٦٧٨')).toBe('٠١٠****٥٦٧٨');
    expect(maskPhone('۰۱۰۱۲۳۴۵۶۷۸')).toBe('۰۱۰****۵۶۷۸');
    expect(maskPhone('+٢٠ ١٠ ١٢٣٤ ٥٦٧٨')).toBe('+٢٠ ١* **** ٥٦٧٨');
  });

  it('never shows a short number whole — only its last half', () => {
    expect(maskPhone('2345678')).toBe('****678');
    expect(maskPhone('1234')).toBe('**34');
    for (const phone of ['01012345678', '2345678', '1234', '+20 10 1234 5678', '٠١٠١٢٣٤٥٦٧٨']) {
      expect(maskPhone(phone), phone).not.toBe(phone.trim());
    }
  });
});

describe('the categories a supplier supplies', () => {
  it('reads their names in the reader’s language, in the supplier’s order, a vanished one skipped', () => {
    const record = supplier({
      categories: [
        { id: 'c-paper', name: { ar: 'الورق', en: 'Paper' } },
        { id: 'c-gone', name: null },
        { id: 'c-ink', name: { ar: 'الأحبار', en: 'Inks' } },
      ],
    });
    expect(supplierCategoryNames(record, 'ar')).toEqual(['الورق', 'الأحبار']);
    expect(supplierCategoryNames(record, 'en')).toEqual(['Paper', 'Inks']);
  });
});

describe('a paper’s scan state (§11.5)', () => {
  it('opens when clean or not scanned, and wears nothing', () => {
    expect(paperState('clean')).toEqual({ opens: true, chip: null });
    expect(paperState('unscanned')).toEqual({ opens: true, chip: null });
  });

  it('waits while being scanned, never opens when blocked, and says when its file is gone', () => {
    expect(paperState('pending')).toEqual({ opens: false, chip: 'pending' });
    expect(paperState('blocked')).toEqual({ opens: false, chip: 'blocked' });
    expect(paperState(null)).toEqual({ opens: false, chip: 'unavailable' });
  });

  it('reads the record again with backoff only while a paper is pending', () => {
    expect(scanRecheckDelay(undefined, 1)).toBe(false);
    expect(scanRecheckDelay([paper(), paper({ scanStatus: 'blocked' })], 1)).toBe(false);
    const pending = [paper(), paper({ attachmentId: 'a-2', scanStatus: 'pending' })];
    expect([1, 2, 3, 4, 5, 6, 9].map((reads) => scanRecheckDelay(pending, reads))).toEqual([
      5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000,
    ]);
  });

  it('starts the doubling at the read that first shows a paper pending, not at the page’s load', () => {
    const clean = [paper()];
    const one = [paper(), paper({ attachmentId: 'a-2', scanStatus: 'pending' })];
    const two = [...one, paper({ attachmentId: 'a-3', scanStatus: 'pending' })];
    // Read 1 loads the record and reads 2–5 are edits: nothing pending, no wait kept.
    expect(nextScanWait(clean, 5, undefined)).toBeUndefined();
    // Read 6 is the re-read after the paper was filed: its first wait is five seconds.
    const filed = nextScanWait(one, 6, undefined) as ScanWait;
    expect(filed).toEqual({ pending: ['a-2'], from: 6 });
    const delay = (reads: number, wait: ScanWait): number | false =>
      scanRecheckDelay(one, reads - wait.from + 1);
    expect(delay(6, filed)).toBe(5_000);
    // The same paper still pending: the wait keeps doubling from where it started.
    const later = nextScanWait(one, 8, filed) as ScanWait;
    expect(later.from).toBe(6);
    expect(delay(8, later)).toBe(20_000);
    // A second paper filed meanwhile starts the wait over.
    expect(nextScanWait(two, 9, later)).toEqual({ pending: ['a-2', 'a-3'], from: 9 });
    // One of two answered: the other keeps its wait.
    expect(nextScanWait(one, 10, { pending: ['a-2', 'a-3'], from: 9 })?.from).toBe(9);
    // None pending any more: the wait ends.
    expect(nextScanWait(clean, 11, later)).toBeUndefined();
  });

  it('holds twenty papers at most (§11.4)', () => {
    expect(papersFull(Array.from({ length: 19 }, () => paper()))).toBe(false);
    expect(papersFull(Array.from({ length: 20 }, () => paper()))).toBe(true);
  });
});

describe('a paper’s size', () => {
  it('reads kilobytes under a megabyte, megabytes above, in the reader’s digits', () => {
    expect(paperSize(245_760, 'en')).toEqual({ unit: 'kb', size: '240' });
    expect(paperSize(245_760, 'ar')).toEqual({ unit: 'kb', size: '٢٤٠' });
    expect(paperSize(3_407_872, 'en')).toEqual({ unit: 'mb', size: '3.3' });
    expect(paperSize(100, 'en')).toEqual({ unit: 'kb', size: '1' });
  });
});
