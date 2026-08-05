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
});
