// The CSV intake, which replaced the gold system's SheetJS reader.
//
// These cover the three things that actually break real files from customers' accountants: the
// separator their Excel chose, quoted fields carrying commas and line breaks, and Arabic column
// headers. Everything else is the mapping, which the last block pins.
import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv, parseImportText } from './receiving-import';

describe('CSV tokenizer', () => {
  it('splits plain rows and keeps empty trailing cells', () => {
    expect(parseCsv('a,b,c\n1,,3', ',')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('honours quoted fields carrying the delimiter, a newline and a doubled quote', () => {
    const text = 'serial,notes\n"GB-1","he said ""hi"", then left"\n"GB-2","line one\nline two"';
    expect(parseCsv(text, ',')).toEqual([
      ['serial', 'notes'],
      ['GB-1', 'he said "hi", then left'],
      ['GB-2', 'line one\nline two'],
    ]);
  });

  it('treats CRLF as one line break', () => {
    expect(parseCsv('a,b\r\n1,2\r\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('does not invent a row for a trailing newline', () => {
    expect(parseCsv('a\n1\n', ',')).toHaveLength(2);
  });
});

describe('delimiter detection', () => {
  it('reads a comma-separated header', () => {
    expect(detectDelimiter('serial,weight,vault\nGB-1,100,V1')).toBe(',');
  });

  // Excel writes the machine's list separator, which is a semicolon in most Arab and European
  // locales — guessing comma there would collapse every row into one cell.
  it('reads a semicolon-separated header', () => {
    expect(detectDelimiter('serial;weight;vault\nGB-1;100;V1')).toBe(';');
  });

  it('reads a tab-separated header', () => {
    expect(detectDelimiter('serial\tweight\tvault\nGB-1\t100\tV1')).toBe('\t');
  });
});

describe('mapping rows to bars', () => {
  it('matches Arabic headers, in any column order', () => {
    const lines = parseImportText(
      ['الدرج,الوزن,سريال السبيكة,العيار,الخزينة', '5,100.5,GB-1,999.9,V1'].join('\n'),
    );
    expect(lines).toEqual([
      {
        serialNumber: 'GB-1',
        brand: '',
        metalType: 'gold',
        weight: '100.5',
        purity: '999.9',
        weightBeforePacking: '',
        weightAfterPacking: '',
        vaultRaw: 'V1',
        drawerRaw: '5',
      },
    ]);
  });

  it('matches English headers and reads the metal out of the type column', () => {
    const lines = parseImportText(
      ['serial,metal,weight,brand', 'GB-1,Silver,50,Emirates', 'GB-2,Platinum,60,'].join('\n'),
    );
    expect(lines.map((l) => l.metalType)).toEqual(['silver', 'platinum']);
    expect(lines[0]?.brand).toBe('Emirates');
  });

  it('strips the byte-order mark a spreadsheet export puts before the first header', () => {
    const lines = parseImportText('﻿serial,weight\nGB-1,100');
    expect(lines[0]?.serialNumber).toBe('GB-1');
    expect(lines[0]?.weight).toBe('100');
  });

  it('keeps a row that has a serial OR a weight, and drops one with neither', () => {
    const lines = parseImportText(
      ['serial,weight,brand', 'GB-1,,', ',250,', ',,just a note', ',,'].join('\n'),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]?.serialNumber).toBe('GB-1');
    expect(lines[1]?.weight).toBe('250');
  });

  it('leaves a column the file does not have as empty rather than shifting the others', () => {
    const lines = parseImportText('serial,weight\nGB-1,100');
    expect(lines[0]?.vaultRaw).toBe('');
    expect(lines[0]?.drawerRaw).toBe('');
    expect(lines[0]?.purity).toBe('');
  });

  it('answers an empty file with no lines instead of throwing', () => {
    expect(parseImportText('')).toEqual([]);
  });

  it('answers a header-only file with no lines', () => {
    expect(parseImportText('serial,weight,vault')).toEqual([]);
  });
});
