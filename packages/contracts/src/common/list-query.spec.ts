// `listQuery` is what lets a filter take several answers, and its whole risk is the day it stops
// accepting the ONE answer every existing link, bookmark and API caller already sends.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { listQuery } from './index.js';

const Status = z.enum(['waiting', 'accepted', 'rejected']);
const schema = z.object({ status: listQuery(Status) }).strict();
const parse = (status: unknown): unknown => schema.parse({ status }).status;

describe('listQuery', () => {
  it('reads a single value as a one-item list — every URL that exists today', () => {
    expect(parse('waiting')).toEqual(['waiting']);
  });

  it('reads a comma-separated list', () => {
    expect(parse('waiting,accepted')).toEqual(['waiting', 'accepted']);
  });

  it('reads a repeated parameter, which is what some clients send', () => {
    expect(parse(['waiting', 'rejected'])).toEqual(['waiting', 'rejected']);
  });

  it('treats an absent or emptied filter as no filter, never as "match nothing"', () => {
    expect(parse(undefined)).toBeUndefined();
    expect(parse('')).toBeUndefined();
    expect(parse(',')).toBeUndefined();
    expect(parse('  ')).toBeUndefined();
  });

  it('tolerates the spacing a hand-edited URL picks up', () => {
    expect(parse('waiting , accepted')).toEqual(['waiting', 'accepted']);
    expect(parse('waiting,,accepted')).toEqual(['waiting', 'accepted']);
  });

  it('still rejects a value outside the enum, one bad entry being enough', () => {
    expect(() => parse('waiting,nonsense')).toThrow();
    expect(() => parse('nonsense')).toThrow();
  });

  it('caps the list so a crafted URL cannot ask for an unbounded $in', () => {
    expect(() => parse(Array.from({ length: 51 }, () => 'waiting').join(','))).toThrow();
  });

  // The cap became a PARAMETER when one caller needed a wider list. Every other caller passes one
  // argument and must be untouched by that, which is what these pin: the default is still exactly
  // 50, an explicit cap applies exactly, and neither leaks into the other.
  describe('the cap', () => {
    const repeat = (n: number): string => Array.from({ length: n }, () => 'waiting').join(',');
    const capped = (max: number) => {
      const s = z.object({ status: listQuery(Status, max) }).strict();
      return (status: unknown): unknown => s.parse({ status }).status;
    };

    it('defaults to 50 when the caller passes only the item schema', () => {
      expect(parse(repeat(50))).toHaveLength(50);
      expect(() => parse(repeat(51))).toThrow();
    });

    it('honours an explicit cap exactly — the limit passes, one more throws', () => {
      expect(capped(100)(repeat(100))).toHaveLength(100);
      expect(() => capped(100)(repeat(101))).toThrow();
    });

    it('honours a NARROWER explicit cap, so the parameter is not a one-way widening', () => {
      expect(capped(2)(repeat(2))).toHaveLength(2);
      expect(() => capped(2)(repeat(3))).toThrow();
    });

    it('keeps every other rule under an explicit cap — empty is still no filter, junk still throws', () => {
      expect(capped(100)('')).toBeUndefined();
      expect(capped(100)('waiting , accepted')).toEqual(['waiting', 'accepted']);
      expect(() => capped(100)('nonsense')).toThrow();
    });
  });
});
