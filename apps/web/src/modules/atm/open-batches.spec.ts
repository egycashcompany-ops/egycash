// The open forms take any number of pasted lines (the owner, 2026-11-01: «كان عندى حوالى 700 تغذية
// لماكينات لما بضيفهم كلهم مره واحده بيجيب الرساله … لكن لما قللتهم 100 او 200 فى المرة بقي يضيف
// عادى»). One open request carries at most `ATM_OPEN_MAX_ROWS` lines, so the form sends them in
// consecutive requests of that size, joined as one answer. A request after the first failing stops
// the run WITHOUT losing what opened: the lines no request carried come back, and only those stay
// in the boxes — a second press never opens a line twice.
//
// Every code below is synthetic.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATM_OPEN_MAX_ROWS,
  OpenAtmMaintenancesSchema,
  OpenAtmReplenishmentsSchema,
} from '@ecms/contracts';
import type * as ApiClientModule from '../../shared/lib/api-client';
import { openMaintenances, openReplenishments } from './api/atm-api';
import { buildReplenishmentRows, replenishmentLines } from './components/OpenReplenishmentsForm';
import { buildMaintenanceRows, maintenanceLines } from './components/OpenMaintenancesForm';

interface SentOpen {
  path: string;
  body: { rows: { machineCode: string }[]; forceDate?: string | null; openedAt?: string | null };
}
const sent: SentOpen[] = [];
/** The request (1-based) the server refuses, if any. */
let failOn: number | null = null;
const refusal = new Error('refused');

vi.mock('../../shared/lib/api-client', async () => {
  const actual = await vi.importActual<typeof ApiClientModule>('../../shared/lib/api-client');
  return {
    ...actual,
    // Every line opens, except a code ending in 9, which the master does not know.
    post: (path: string, body: SentOpen['body']) => {
      sent.push({ path, body });
      if (failOn !== null && sent.length === failOn) return Promise.reject(refusal);
      const known = body.rows.filter((row) => !row.machineCode.endsWith('9'));
      return Promise.resolve({
        opened: known.map((row) => ({ id: `op-${row.machineCode}`, machineCode: row.machineCode })),
        unknownCodes: body.rows
          .filter((row) => row.machineCode.endsWith('9'))
          .map((row) => row.machineCode),
        alreadyOpenCodes: [],
      });
    },
  };
});

afterEach(() => {
  sent.length = 0;
  failOn = null;
});

/** `n` lines with distinct codes — 99990000, 99990001, … */
const codes = (n: number): string[] =>
  Array.from({ length: n }, (_unused, i) => String(99990000 + i));
const repRows = (n: number) =>
  codes(n).map((machineCode, i) => ({
    machineCode,
    scheduleTime: i % 3 === 0 ? null : `${String(8 + (i % 10))}:00`,
  }));
const maintRows = (n: number) =>
  codes(n).map((machineCode, i) => ({
    machineCode,
    serviceType: i % 2 === 0 ? 'Cash out' : null,
    referenceNumber: i % 5 === 0 ? null : `REF-${String(i)}`,
  }));

describe('one open request carries at most ATM_OPEN_MAX_ROWS lines — the API’s own cap', () => {
  it.each([
    ['replenishment', OpenAtmReplenishmentsSchema, repRows],
    ['maintenance', OpenAtmMaintenancesSchema, maintRows],
  ] as const)('%s: 200 lines pass, 201 are refused', (_kind, schema, rows) => {
    expect(ATM_OPEN_MAX_ROWS).toBe(200);
    expect(() => schema.parse({ rows: rows(ATM_OPEN_MAX_ROWS) })).not.toThrow();
    expect(() => schema.parse({ rows: rows(ATM_OPEN_MAX_ROWS + 1) })).toThrow();
  });
});

describe('a paste longer than one request goes in consecutive requests, joined as one', () => {
  it('700 replenishments: four requests of 200, 200, 200 and 100, in order, one date for all', async () => {
    const rows = repRows(700);
    const outcome = await openReplenishments({ rows, forceDate: '2026-11-02' });
    expect(sent.map((request) => request.path)).toEqual(Array(4).fill('/atm/replenishments/open'));
    expect(sent.map((request) => request.body.rows.length)).toEqual([200, 200, 200, 100]);
    expect(sent.every((request) => request.body.forceDate === '2026-11-02')).toBe(true);
    // Every line went, once, in the paste's order.
    expect(sent.flatMap((request) => request.body.rows)).toEqual(rows);
    expect(outcome.opened.map((row) => row.machineCode)).toEqual(
      codes(700).filter((code) => !code.endsWith('9')),
    );
    expect(outcome.unknownCodes).toEqual(codes(700).filter((code) => code.endsWith('9')));
    expect(outcome.unsent).toEqual([]);
    expect(outcome.failure).toBeNull();
  });

  it('450 maintenances: 200, 200 and 50, one open time for all', async () => {
    const rows = maintRows(450);
    const openedAt = '2026-11-01T08:00:00.000Z';
    const outcome = await openMaintenances({ rows, openedAt });
    expect(sent.map((request) => request.path)).toEqual(Array(3).fill('/atm/maintenances/open'));
    expect(sent.map((request) => request.body.rows.length)).toEqual([200, 200, 50]);
    expect(sent.every((request) => request.body.openedAt === openedAt)).toBe(true);
    expect(sent.flatMap((request) => request.body.rows)).toEqual(rows);
    expect(outcome.unsent).toEqual([]);
  });

  it('200 lines or fewer: one request, as before', async () => {
    await openReplenishments({ rows: repRows(200), forceDate: null });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body.forceDate).toBeNull();
  });
});

describe('a request that fails', () => {
  it('the FIRST: the open fails as before — nothing was opened, nothing more is sent', async () => {
    failOn = 1;
    await expect(openReplenishments({ rows: repRows(700), forceDate: null })).rejects.toBe(refusal);
    expect(sent).toHaveLength(1);
  });

  it('a LATER one: what opened stands, and the lines not sent come back with the reason', async () => {
    failOn = 3;
    const rows = repRows(700);
    const outcome = await openReplenishments({ rows, forceDate: null });
    expect(sent).toHaveLength(3); // the fourth is never sent
    expect(outcome.opened.map((row) => row.machineCode)).toEqual(
      codes(400).filter((code) => !code.endsWith('9')),
    );
    expect(outcome.unsent).toEqual(rows.slice(400));
    expect(outcome.failure).toBe(refusal);
  });

  it('maintenance: the same', async () => {
    failOn = 2;
    const rows = maintRows(450);
    const outcome = await openMaintenances({ rows, openedAt: null });
    expect(sent).toHaveLength(2);
    expect(outcome.unsent).toEqual(rows.slice(200));
    expect(outcome.failure).toBe(refusal);
  });
});

describe('the lines not sent go back into the boxes exactly', () => {
  it('replenishment: codes and schedule times, line for line — blanks kept in place', () => {
    const rows = repRows(10);
    const left = replenishmentLines(rows);
    expect(left.codes.split('\n')).toEqual(codes(10));
    expect(left.schedules.split('\n')[0]).toBe('');
    expect(buildReplenishmentRows(left.codes, left.schedules)).toEqual(rows);
  });

  it('maintenance: codes, service types and reference numbers, line for line', () => {
    const rows = maintRows(10);
    const left = maintenanceLines(rows);
    expect(buildMaintenanceRows(left.codes, left.services, left.references)).toEqual(rows);
  });
});
