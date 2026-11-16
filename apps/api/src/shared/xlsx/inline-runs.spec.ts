// Inline rich text joined for ExcelJS's streaming reader, which reads a cell of runs as its last
// run alone: what is joined (the text Excel shows), what is kept as it is (everything else, byte
// for byte), and the escapes a run leaves unfinished. Through a whole upload:
// modules/it/assets/asset-import.spec.ts.
import { describe, expect, it } from 'vitest';
import { danglingEscapeAt, joinInlineRuns } from './inline-runs';

const joined = (xml: string): string => joinInlineRuns(Buffer.from(xml, 'utf8')).toString('utf8');

const cell = (content: string, ref = 'B2'): string =>
  `<c r="${ref}" t="inlineStr"><is>${content}</is></c>`;

const sheet = (...cells: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet><sheetData><row r="2">${cells.join('')}</row></sheetData></worksheet>`;

const JOINED = (text: string): string => `<t xml:space="preserve">${text}</t>`;

describe('joining inline runs', () => {
  it('joins an inline string’s runs into one text — the rest of the sheet byte for byte', () => {
    const before = sheet(
      cell('<t>Dell</t>', 'A2'),
      cell(
        '<r><t xml:space="preserve">شاشة ديل </t></r><r><rPr><b/><rFont val="Arial"/></rPr><t>E2020H</t></r>',
      ),
      `<c r="C2" t="s"><v>3</v></c>`,
    );
    expect(joined(before)).toBe(
      sheet(
        cell('<t>Dell</t>', 'A2'),
        cell(JOINED('شاشة ديل E2020H')),
        `<c r="C2" t="s"><v>3</v></c>`,
      ),
    );
  });

  it('hands back the very buffer when no inline string holds more than one text', () => {
    for (const xml of [
      sheet(`<c r="A2" t="s"><v>0</v></c>`),
      sheet(
        cell('<t>QW7RT52</t>'),
        cell('<r><rPr><b/></rPr><t>Dell</t></r>', 'C2'),
        cell('', 'D2'),
      ),
      sheet(`<c r="A2" t="inlineStr"><is/></c>`),
    ]) {
      const buffer = Buffer.from(xml, 'utf8');
      expect(joinInlineRuns(buffer)).toBe(buffer);
    }
  });

  it('keeps each run’s bytes as they are — entities escaped, whitespace inside a run kept', () => {
    expect(joined(sheet(cell('<r><t>R&amp;D </t></r><r><t>&lt;7RT52&gt;</t></r>')))).toBe(
      sheet(cell(JOINED('R&amp;D &lt;7RT52&gt;'))),
    );
    // The layout between runs is no text of the cell's; an empty run adds nothing.
    expect(
      joined(sheet(cell('\n  <r><t>شاشة </t></r>\n  <r><t/></r>\n  <r><t>ديل</t></r>\n'))),
    ).toBe(sheet(cell(JOINED('شاشة ديل'))));
  });

  it('leaves out a phonetic guide — Excel does not show it in the cell', () => {
    expect(
      joined(
        sheet(cell('<t>漢字</t><rPh sb="0" eb="2"><t>かんじ</t></rPh><phoneticPr fontId="1"/>')),
      ),
    ).toBe(sheet(cell(JOINED('漢字'))));
    expect(
      joined(sheet(cell('<r><t>A</t></r><r><t>B</t></r><rPh sb="0" eb="1"><t>x</t></rPh>'))),
    ).toBe(sheet(cell(JOINED('AB'))));
  });

  it('finds no inline string inside a comment or a CDATA section, nor a tag end inside a value', () => {
    const hidden = '<is><r><t>x</t></r><r><t>y</t></r></is>';
    const buffer = Buffer.from(
      sheet(`<!-- ${hidden} -->`, `<extLst><ext><![CDATA[${hidden}]]></ext></extLst>`),
      'utf8',
    );
    expect(joinInlineRuns(buffer)).toBe(buffer);
    expect(
      joined(
        sheet(`<c r="B2" t="inlineStr" x:note="a>b"><is><r><t>A</t></r><r><t>B</t></r></is></c>`),
      ),
    ).toBe(sheet(`<c r="B2" t="inlineStr" x:note="a>b"><is>${JOINED('AB')}</is></c>`));
  });

  it('writes a crafted sheet that grows when joined whole — two bare texts per cell', () => {
    const cells = Array.from({ length: 40 }, (_, index) =>
      cell('<t>a</t><t>b</t>', `A${String(index + 2)}`),
    );
    const before = sheet(...cells);
    const after = joined(before);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after).toBe(
      sheet(
        ...Array.from({ length: 40 }, (_, index) => cell(JOINED('ab'), `A${String(index + 2)}`)),
      ),
    );
  });

  it('leaves an inline string that never closes as it came', () => {
    const open =
      sheet(cell('<r><t>A</t></r><r><t>B</t></r>', 'A2')) + '<c><is><r><t>C</t></r><r><t>D';
    expect(joined(open)).toBe(sheet(cell(JOINED('AB'), 'A2')) + '<c><is><r><t>C</t></r><r><t>D');
  });

  it('writes a `_` a run leaves dangling as Excel writes a typed one — no run completes another’s escape', () => {
    // «_x00» then «41_»: Excel shows «_x0041_»; joined bare they would decode to «A».
    expect(joined(sheet(cell('<r><t>جهاز_x00</t></r><r><t>41_</t></r>')))).toBe(
      sheet(cell(JOINED('جهاز_x005F_x00' + '41_'))),
    );
    // An escape whole in one run is that run's own: left as it is, and nothing dangles after it.
    expect(joined(sheet(cell('<r><t>كابل_x000D_</t></r><r><t>x0041_</t></r>')))).toBe(
      sheet(cell(JOINED('كابل_x000D_x0041_'))),
    );
    // The last run has nothing after it to complete.
    expect(joined(sheet(cell('<r><t>A</t></r><r><t>B_x00</t></r>')))).toBe(
      sheet(cell(JOINED('AB_x00'))),
    );
  });

  it('finds a dangling escape as the decoder reads escapes — left to right, none overlapping', () => {
    const at = (text: string): number => {
      const buffer = Buffer.from(`<<${text}>>`, 'latin1');
      const found = danglingEscapeAt(buffer, 2, 2 + text.length);
      return found === -1 ? -1 : found - 2;
    };
    expect(at('a_')).toBe(1);
    expect(at('_x')).toBe(0);
    expect(at('_x00')).toBe(0);
    expect(at('_x004F')).toBe(0);
    expect(at('a_x00_')).toBe(5);
    expect(at('_x0041_')).toBe(-1);
    expect(at('_x0041_x00')).toBe(-1);
    expect(at('_x0041_x00_x0')).toBe(10);
    expect(at('_xZ')).toBe(-1);
    expect(at('_X00')).toBe(-1);
    expect(at('ab')).toBe(-1);
    expect(at('')).toBe(-1);
  });
});
