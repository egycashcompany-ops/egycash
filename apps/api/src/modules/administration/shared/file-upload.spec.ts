// The module's multipart intake (design §11.2): the cap sits 5 MB above its category's limit and
// never above the deployment's own, so the category is the limit a user meets; and an Arabic file
// name multer read as latin1 comes back as the person typed it, while a name that was never
// mangled is left alone.
import { describe, expect, it } from 'vitest';
import { uploadCapMb, uploadedFileName } from './file-upload';

describe('the multipart cap', () => {
  it('is the category’s limit plus 5 MB — 15 over 10, 25 over 20', () => {
    expect(uploadCapMb(10, 25)).toBe(15);
    expect(uploadCapMb(20, 25)).toBe(25);
  });

  it('never rises above the deployment’s MAX_UPLOAD_MB', () => {
    expect(uploadCapMb(10, 12)).toBe(12);
    expect(uploadCapMb(20, 20)).toBe(20);
  });
});

describe('the uploaded file’s name', () => {
  it('turns a latin1-read Arabic name back into the one the person gave', () => {
    const typed = 'السجل التجاري.pdf';
    const asMulterReadsIt = Buffer.from(typed, 'utf8').toString('latin1');
    expect(asMulterReadsIt).not.toBe(typed);
    expect(uploadedFileName(asMulterReadsIt)).toBe(typed);
  });

  it('leaves a plain or an already-decoded name as it came', () => {
    expect(uploadedFileName('registry.pdf')).toBe('registry.pdf');
    expect(uploadedFileName('البطاقة الضريبية.png')).toBe('البطاقة الضريبية.png');
  });

  it('keeps a latin1 name that is not UTF-8 underneath, rather than making it worse', () => {
    expect(uploadedFileName('café.pdf')).toBe('café.pdf');
  });

  it('answers an empty name for none', () => {
    expect(uploadedFileName(undefined)).toBe('');
    expect(uploadedFileName('')).toBe('');
  });
});
