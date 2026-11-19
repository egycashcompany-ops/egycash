// `stream-text.ts` on its own (Round 29 critic): the two rules the branch sheet's streaming read
// takes from the IT assets upload had no spec of their own here, so a change to this copy was
// pinned by nothing. Each rule as `stream-text.ts` states it: `readSlices` cuts only between
// characters and never before a U+FEFF, bounded, as views; `decodeXstring` decodes Excel's
// `_xHHHH_` escapes left to right, none overlapping, as `xlsx.load` does.
import { describe, expect, it } from 'vitest';
import { decodeXstring, readSlices } from './stream-text';

const BOM = '﻿';
const BOM_BYTES = Buffer.from(BOM, 'utf8');

/** Each piece decoded on its own — as ExcelJS's `parse-sax` decodes what it is handed. */
const decodedApart = (pieces: readonly Buffer[]): string =>
  pieces.map((piece) => new TextDecoder().decode(piece)).join('');

/** A seeded generator (mulberry32), so a failure replays. */
const seeded = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

describe('readSlices', () => {
  it('hands the buffer over in order, as views of it, and nothing for an empty one', () => {
    const buffer = Buffer.from('0123456789');
    const slices = [...readSlices(buffer, 4)];
    expect(slices.map((slice) => slice.toString())).toEqual(['0123', '4567', '89']);
    expect(slices.every((slice) => slice.buffer === buffer.buffer)).toBe(true);
    expect([...readSlices(Buffer.alloc(0), 4)]).toEqual([]);
  });

  it('never cuts inside an Arabic letter — decoded apart, the text is the text', () => {
    // «فرع النخلة»: two bytes a letter, one a space — every size cuts somewhere inside one.
    const text = 'فرع النخلة — شارع ٣٤ الزيزفون';
    const buffer = Buffer.from(text, 'utf8');
    for (let size = 1; size <= 16; size += 1) {
      const slices = [...readSlices(buffer, size)];
      expect(Buffer.concat(slices).equals(buffer), `size ${String(size)}`).toBe(true);
      expect(decodedApart(slices), `size ${String(size)}`).toBe(text);
      // A slice is at most three bytes past the size: a UTF-8 character's continuation bytes.
      expect(slices.every((slice) => slice.length <= size + 3)).toBe(true);
    }
  });

  it('moves a cut past a U+FEFF — a slice starting with one would lose it', () => {
    // «معالج» is ten bytes: the cut at 10 falls right before the U+FEFF.
    const word = Buffer.from(`معالج${BOM}إنتل`, 'utf8');
    const slices = [...readSlices(word, 10)];
    expect(slices.map((slice) => slice.toString('utf8'))).toEqual([`معالج${BOM}`, 'إنتل']);
    expect(decodedApart(slices)).toBe(`معالج${BOM}إنتل`);
    // Without the move the decoder takes it for a byte-order mark and drops it.
    expect(decodedApart([word.subarray(0, 10), word.subarray(10)])).toBe('معالجإنتل');
  });

  it('cuts random UTF-8 on characters at every size, never before a U+FEFF', () => {
    const random = seeded(20261119);
    const ranges: readonly (readonly [number, number])[] = [
      [0x20, 0x7e],
      [0x0621, 0x064a],
      [0x1f300, 0x1f5ff],
      [0xfeff, 0xfeff],
    ];
    for (let sample = 0; sample < 40; sample += 1) {
      const text = Array.from({ length: Math.floor(random() * 120) }, () => {
        const [from, to] = ranges[Math.floor(random() * ranges.length)] ?? [0x20, 0x20];
        return String.fromCodePoint(from + Math.floor(random() * (to - from + 1)));
      }).join('');
      const buffer = Buffer.from(text, 'utf8');
      const whole = new TextDecoder().decode(buffer);
      for (let size = 1; size <= 32; size += 1) {
        const slices = [...readSlices(buffer, size)];
        expect(Buffer.concat(slices).equals(buffer)).toBe(true);
        expect(slices.every((slice) => slice.length > 0)).toBe(true);
        expect(slices.slice(1).some((slice) => ((slice[0] ?? 0) & 0xc0) === 0x80)).toBe(false);
        expect(slices.slice(1).some((slice) => slice.subarray(0, 3).equals(BOM_BYTES))).toBe(false);
        expect(decodedApart(slices)).toBe(whole);
      }
    }
  });

  it('stays bounded on bytes that are no UTF-8 — a crafted run cannot stretch a slice', () => {
    expect([...readSlices(Buffer.alloc(20, 0x80), 4)].map((slice) => slice.length)).toEqual([
      7, 7, 6,
    ]);
  });
});

describe('decodeXstring', () => {
  it('decodes `_xHHHH_` to its UTF-16 code unit, in either case of hex', () => {
    expect(decodeXstring('فرع_x000D_\nالنخلة')).toBe('فرع\r\nالنخلة');
    expect(decodeXstring('116_x000d_')).toBe('116\r');
    expect(decodeXstring('_xD83D__xDE00_')).toBe('\u{1F600}');
  });

  it('decodes left to right, none overlapping — an escaped «_» stays one', () => {
    expect(decodeXstring('_x005F_x0041_')).toBe('_x0041_');
    expect(decodeXstring('_x0041_x0042_')).toBe('Ax0042_');
    expect(decodeXstring('__x0041_')).toBe('_A');
  });

  it('leaves alone what is no escape', () => {
    expect(decodeXstring('_x00_ _x00G1_ x0041_ _X0041_')).toBe('_x00_ _x00G1_ x0041_ _X0041_');
    expect(decodeXstring('فرع النخلة')).toBe('فرع النخلة');
  });
});
