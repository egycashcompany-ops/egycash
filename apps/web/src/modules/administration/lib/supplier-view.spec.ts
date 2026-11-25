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
    expect(scanRecheckDelay(undefined, 0)).toBe(false);
    expect(scanRecheckDelay([paper(), paper({ scanStatus: 'blocked' })], 0)).toBe(false);
    const pending = [paper(), paper({ attachmentId: 'a-2', scanStatus: 'pending' })];
    // Each wait is about as long as the paper has waited so far: 5, 5, 10, 20, 40, then a minute.
    const waits: number[] = [];
    let elapsed = 0;
    for (let read = 0; read < 7; read += 1) {
      const delay = scanRecheckDelay(pending, elapsed) as number;
      waits.push(delay);
      elapsed += delay;
    }
    expect(waits).toEqual([5_000, 5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  it('starts the wait when a paper is first seen pending, and an echo a moment later skips nothing', () => {
    const clean = [paper()];
    const one = [paper(), paper({ attachmentId: 'a-2', scanStatus: 'pending' })];
    const two = [...one, paper({ attachmentId: 'a-3', scanStatus: 'pending' })];
    // The page has been open a long while with nothing pending: no wait kept.
    expect(nextScanWait(clean, 600_000, undefined)).toBeUndefined();
    // The write's own re-read first shows the paper pending: its first wait is five seconds.
    const filed = nextScanWait(one, 600_000, undefined) as ScanWait;
    expect(filed).toEqual({ pending: ['a-2'], since: 600_000 });
    expect(scanRecheckDelay(one, 600_000 - filed.since)).toBe(5_000);
    // The realtime echo of the same write, 0.3 s later, keeps the five seconds.
    const echo = nextScanWait(one, 600_300, filed) as ScanWait;
    expect(echo.since).toBe(600_000);
    expect(scanRecheckDelay(one, 600_300 - echo.since)).toBe(5_000);
    // Still pending twenty seconds on: the next wait is twenty seconds.
    const later = nextScanWait(one, 620_000, echo) as ScanWait;
    expect(scanRecheckDelay(one, 620_000 - later.since)).toBe(20_000);
    // A second paper filed meanwhile starts the wait over.
    expect(nextScanWait(two, 625_000, later)).toEqual({ pending: ['a-2', 'a-3'], since: 625_000 });
    // One of two answered: the other keeps its wait.
    expect(nextScanWait(one, 630_000, { pending: ['a-2', 'a-3'], since: 625_000 })?.since).toBe(
      625_000,
    );
    // None pending any more: the wait ends.
    expect(nextScanWait(clean, 640_000, later)).toBeUndefined();
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
