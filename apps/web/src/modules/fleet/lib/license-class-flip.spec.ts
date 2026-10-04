// «لو غير فئة الترخيص من ت ل م او م ل ت … لازم يعدل تاريخ انتهاء الترخيص ولو عدل التاريخ تلقائى لو م
// تبقى ت ولو ت تبقى م».
import { describe, expect, it } from 'vitest';
import { counterpartClass, letterFlipped, licenseLetter } from './license-class-flip';

const classes = [
  { id: 'bm', name: 'برقاش م' },
  { id: 'bt', name: 'برقاش ت' },
  { id: 'am', name: 'العجوزة م' },
  { id: 'at', name: 'العجوزة ت ' },
  { id: 'x', name: 'خاص' },
];

describe('the licence letter', () => {
  it('is the last word, م or ت, spaces and all', () => {
    expect(licenseLetter('برقاش م')).toBe('م');
    expect(licenseLetter(' العجوزة ت ')).toBe('ت');
    expect(licenseLetter('خاص')).toBeNull();
  });

  it('the counterpart is the same unit with the other letter — never another unit', () => {
    expect(counterpartClass(classes, 'bm')?.id).toBe('bt');
    expect(counterpartClass(classes, 'at')?.id).toBe('am');
    expect(counterpartClass(classes, 'x')).toBeNull();
  });

  it('a flip is م↔ت only — a change of unit with the same letter is not one', () => {
    expect(letterFlipped(classes, 'bm', 'bt')).toBe(true);
    expect(letterFlipped(classes, 'bm', 'am')).toBe(false);
    expect(letterFlipped(classes, 'bm', 'x')).toBe(false);
  });
});
