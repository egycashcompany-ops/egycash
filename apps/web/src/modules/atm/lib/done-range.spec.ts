// The done range read whole, chunk after chunk — never every page at once (the hang of 2026-11-25).
import { describe, expect, it } from 'vitest';
import { type AtmDoneRangeChunkDto } from '@ecms/contracts';
import { readDoneRange } from './done-range';

type Row = { id: string };

/** A server holding `count` rows, answering chunks of `size` and counting what is in flight. */
const server = (count: number, size: number) => {
  const rows = Array.from({ length: count }, (_unused, i) => ({ id: `r${String(i)}` }));
  const asked: (string | undefined)[] = [];
  let inFlight = 0;
  let mostInFlight = 0;
  const fetchChunk = async (cursor: string | undefined): Promise<AtmDoneRangeChunkDto<Row>> => {
    asked.push(cursor);
    inFlight += 1;
    mostInFlight = Math.max(mostInFlight, inFlight);
    await Promise.resolve();
    const start = cursor === undefined ? 0 : Number(cursor);
    const items = rows.slice(start, start + size);
    inFlight -= 1;
    return { items, next: start + size < rows.length ? String(start + size) : null };
  };
  return {
    rows,
    asked,
    fetchChunk,
    get mostInFlight() {
      return mostInFlight;
    },
  };
};

describe('the done range, read whole', () => {
  it('reads every chunk in turn, each from the cursor the previous one gave', async () => {
    const db = server(12, 5);
    const read = await readDoneRange(db.fetchChunk);
    expect(read.items).toEqual(db.rows);
    expect(db.asked).toEqual([undefined, '5', '10']);
  });

  it('asks for one chunk at a time — never two in flight', async () => {
    const db = server(30, 5);
    await readDoneRange(db.fetchChunk);
    expect(db.mostInFlight).toBe(1);
  });

  it('is never cut short: its one «page» is the whole range', async () => {
    const db = server(24_874, 5000);
    const read = await readDoneRange(db.fetchChunk);
    expect(read.items).toHaveLength(24_874);
    expect(read.meta).toMatchObject({ totalItems: 24_874, totalPages: 1 });
  });

  it('stops asking once the range it was reading is left behind', async () => {
    const db = server(30, 5);
    const controller = new AbortController();
    const slow = async (cursor: string | undefined): Promise<AtmDoneRangeChunkDto<Row>> => {
      const answer = await db.fetchChunk(cursor);
      controller.abort();
      return answer;
    };
    await expect(readDoneRange(slow, controller.signal)).rejects.toBeDefined();
    expect(db.asked).toHaveLength(1);
  });
});
