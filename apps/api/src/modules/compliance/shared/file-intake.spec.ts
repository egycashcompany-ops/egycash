import { describe, expect, it } from 'vitest';
import {
  contentMatches,
  coverBinary,
  documentBinary,
  uploadCapMb,
  uploadedFileName,
} from './file-intake';

const file = (originalname: string, buffer: Buffer, mimetype = 'application/octet-stream') =>
  ({ originalname, buffer, mimetype, size: buffer.length }) as Express.Multer.File;

const PDF = Buffer.from('%PDF-1.7\n', 'latin1');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe('the upload cap', () => {
  it('sits 5 MB above the 20 MB limit, never above the deployment’s', () => {
    expect(uploadCapMb(20, 100)).toBe(25);
    expect(uploadCapMb(20, 22)).toBe(22);
  });
});

describe('a file name', () => {
  it('arrives as UTF-8 read as latin1 and is turned back', () => {
    const raw = Buffer.from('عقد التوريد.pdf', 'utf8').toString('latin1');
    expect(uploadedFileName(raw)).toBe('عقد التوريد.pdf');
    expect(uploadedFileName('already.pdf')).toBe('already.pdf');
  });
});

describe('the content check', () => {
  it('knows each kind by its first bytes', () => {
    expect(contentMatches('.pdf', PDF)).toBe(true);
    expect(contentMatches('.pdf', Buffer.concat([Buffer.from('\r\n'), PDF]))).toBe(true);
    expect(contentMatches('.docx', ZIP)).toBe(true);
    expect(contentMatches('.xlsx', ZIP)).toBe(true);
    expect(contentMatches('.doc', OLE)).toBe(true);
    expect(contentMatches('.xls', OLE)).toBe(true);
    expect(contentMatches('.pdf', PNG)).toBe(false);
    expect(contentMatches('.docx', OLE)).toBe(false);
    expect(contentMatches('.txt', PDF)).toBe(false);
  });
});

describe('a document', () => {
  it('takes its type from its name, whatever the browser sent', () => {
    const { binary, kind } = documentBinary(file('Policy.DOCX', ZIP));
    expect(kind).toBe('word');
    expect(binary.mime).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('is refused when it is not PDF, Word or Excel', () => {
    expect(() => documentBinary(file('notes.txt', PDF))).toThrow(/only PDF/);
  });

  it('is refused when its content is not what its name says', () => {
    expect(() => documentBinary(file('scan.pdf', PNG))).toThrow(/not a \.pdf/);
  });
});

describe('a cover', () => {
  it('is a picture, known by its bytes', () => {
    expect(coverBinary(file('c.jpg', PNG, 'image/jpeg')).mime).toBe('image/png');
    expect(() => coverBinary(file('c.png', PDF, 'image/png'))).toThrow(/picture/);
  });
});
