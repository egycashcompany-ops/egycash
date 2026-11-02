import { describe, expect, it } from 'vitest';
import { fileStem, toCsv } from './download';

describe('national-id downloads', () => {
  it('names files by a full national ID only', () => {
    expect(fileStem('29001011234567')).toBe('national-id-29001011234567');
    expect(fileStem('2900101')).toBe('national-id');
    expect(fileStem('')).toBe('national-id');
  });

  it('writes a BOM-led CSV that Excel reads, quoting commas, quotes and line breaks', () => {
    const csv = toCsv([
      ['الحقل', 'القيمة'],
      ['Address', '12 شارع النيل، الجيزة, Egypt'],
      ['Note', 'say "hi"\nthere'],
    ]);
    expect(csv.startsWith(String.fromCharCode(0xfeff))).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'الحقل,القيمة',
      'Address,"12 شارع النيل، الجيزة, Egypt"',
      'Note,"say ""hi""\nthere"',
    ]);
  });

  it('never lets a value run as a spreadsheet formula', () => {
    expect(toCsv([['x', '=1+1']]).slice(1)).toBe("x,'=1+1");
    expect(toCsv([['x', '@SUM(A1)']]).slice(1)).toBe("x,'@SUM(A1)");
  });
});
