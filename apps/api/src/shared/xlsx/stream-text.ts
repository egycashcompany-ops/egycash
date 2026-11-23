// Two rules for reading a reduced workbook (`one-sheet-zip.ts`) with ExcelJS's STREAMING reader so
// that its text is the text Excel shows — the IT assets bulk upload's own, measured there
// (`modules/it/assets/asset-import-sheet.ts`, 2026-11-16), and shared here for Operations' branch
// sheet (Round 29): a business module never imports another module's code.
//
//   · `readSlices` — hand the reduced zip over in 64 KB slices, never whole: whole, it is one chunk,
//     and the parser turns a chunk into events all at once, so «stop past the cap» bounds nothing.
//     Each cut moves past UTF-8 continuation bytes (a cut inside an Arabic letter became two
//     U+FFFD) and past a byte-order mark after it (a slice starting with one lost it).
//   · `decodeXstring` — Excel's `_xHHHH_` escapes, which the streaming reader never decodes
//     (a carriage return stored as `_x000D_` reached the register as text).

/** A UTF-8 character's continuation bytes, at most. */
const UTF8_MAX_CONTINUATION = 3;
/** U+FEFF in UTF-8. */
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** The buffer as views of at most `size` (+3, + any U+FEFF run) bytes, each cut on a character. */
export function* readSlices(buffer: Buffer, size: number): Generator<Buffer> {
  const continues = (at: number): boolean =>
    at < buffer.length && ((buffer[at] ?? 0) & 0xc0) === 0x80;
  const bomAt = (at: number): boolean =>
    buffer[at] === UTF8_BOM[0] && buffer[at + 1] === UTF8_BOM[1] && buffer[at + 2] === UTF8_BOM[2];
  for (let at = 0; at < buffer.length;) {
    let end = Math.min(at + size, buffer.length);
    for (let moved = 0; moved < UTF8_MAX_CONTINUATION && continues(end); moved += 1) end += 1;
    while (bomAt(end)) end += UTF8_BOM.length;
    yield buffer.subarray(at, end);
    at = end;
  }
}

/**
 * Excel's escapes in a cell's text (ECMA-376 ST_Xstring): `_xHHHH_` is the UTF-16 code unit HHHH,
 * decoded left to right, none overlapping — as `xlsx.load` decodes its shared strings.
 */
export const decodeXstring = (text: string): string =>
  text.includes('_x')
    ? text.replace(/_x([0-9A-Fa-f]{4})_/gu, (_escape, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
    : text;
