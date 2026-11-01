// An Arabic file name must reach the record as the person typed it, whatever multer's charset —
// and the fix must never damage a name that was already right.
import { describe, expect, it } from 'vitest';
import { uploadFileName } from './upload-file-name';

/** What multer hands over for a UTF-8 name read as latin1. */
const mangled = (name: string): string => Buffer.from(name, 'utf8').toString('latin1');

describe('uploadFileName', () => {
  it('restores an Arabic name multer read as latin1', () => {
    expect(mangled('صفحة 1.png')).not.toBe('صفحة 1.png');
    expect(uploadFileName(mangled('صفحة 1.png'))).toBe('صفحة 1.png');
    expect(uploadFileName(mangled('عقد توريد — ديسمبر.pdf'))).toBe('عقد توريد — ديسمبر.pdf');
  });

  it('keeps an ASCII name as it is', () => {
    expect(uploadFileName('contract-page-1.PNG')).toBe('contract-page-1.PNG');
  });

  it('keeps a name that already arrived as UTF-8', () => {
    expect(uploadFileName('صفحة 1.png')).toBe('صفحة 1.png');
    expect(uploadFileName('Fuel sheet – أكتوبر.xlsx')).toBe('Fuel sheet – أكتوبر.xlsx');
  });

  it('keeps a real latin1 name that is not UTF-8 underneath', () => {
    expect(uploadFileName('café.png')).toBe('café.png');
  });

  it('is empty for no name', () => {
    expect(uploadFileName(undefined)).toBe('');
    expect(uploadFileName('')).toBe('');
  });
});
