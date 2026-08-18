// Phase C1 — the captain's day, before a single stop is drawn.
//
// The two things this slice has to get right are both invisible in a screenshot:
//
//   1. WHOSE day it is. The captain is an ordinary ECMS employee and the server resolves him from
//      the token. No screen, hook or request in this module may name a captain — that is the
//      identity constraint, and it is asserted here against the SOURCE, because a `captainId` that
//      crept into a query string would still render perfectly.
//
//   2. WHICH empty screen to show. `notCaptain` and `noStops` both have zero stops and mean
//      opposite things: one is "you have no duty today", the other is "you are rostered and
//      dispatch has not given you a stop yet". Telling a rostered captain he has no duty is the
//      failure `isCaptainOnDay` exists to prevent.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type OperationsMobileDayDto, type OperationsMobileStopDto } from '@ecms/contracts';
import { captainDayState, currentStop, dayProgress, nextAction } from './day-view';
import { resolveMyDayDate } from './CaptainDayPage';

const stop = (over: Partial<OperationsMobileStopDto> = {}): OperationsMobileStopDto =>
  ({
    assignmentId: 'a-1',
    shipmentId: 's-1',
    operationsDayId: 'd-1',
    sequence: 1,
    leg: 'pickup',
    vehicleId: 'v-1',
    crewAssignmentId: 'c-1',
    shipmentType: 'daily',
    status: 'assigned',
    progress: 'current',
    executionStatus: 'pending',
    startedAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    completedAt: null,
    version: 0,
    referenceNumber: 'REF-1',
    packaging: null,
    pickup: {
      branchId: 'b-1',
      branchName: 'فرع التحرير',
      branchCode: '001',
      bankName: 'البنك الأهلي',
      areaName: 'وسط البلد',
      location: null,
    },
    delivery: {
      branchId: 'b-2',
      branchName: 'فرع المهندسين',
      branchCode: '002',
      bankName: 'البنك الأهلي',
      areaName: 'المهندسين',
      location: null,
    },
    ...over,
  }) as OperationsMobileStopDto;

const day = (over: Partial<OperationsMobileDayDto> = {}): OperationsMobileDayDto =>
  ({
    date: '2026-08-18T00:00:00.000Z',
    operationsDayId: 'd-1',
    dayStatus: 'open',
    captain: { employeeId: 'e-1', code: 'EMP-0007', fullNameAr: 'محمود سيد' },
    isCaptainOnDay: true,
    assignments: [],
    stops: [],
    currentAssignmentId: null,
    ...over,
  }) as OperationsMobileDayDto;

describe('which day is this — four facts, four screens', () => {
  it('says the day is not open when there is no operating day', () => {
    expect(captainDayState(day({ operationsDayId: null, isCaptainOnDay: false }))).toBe('noDay');
  });

  it('says "no duty" for an employee who is not on today’s crew', () => {
    expect(captainDayState(day({ isCaptainOnDay: false }))).toBe('notCaptain');
  });

  it('says "rostered, nothing assigned yet" for a captain with no stops', () => {
    // The distinction this whole field exists for: same empty `stops`, opposite meaning.
    expect(captainDayState(day({ isCaptainOnDay: true, stops: [] }))).toBe('noStops');
  });

  it('reads captaincy from isCaptainOnDay, NEVER from the number of stops', () => {
    // A captain with stops but the flag false is contradictory data; the flag is the authority,
    // because it is the crew row and the stops are a consequence of dispatch.
    expect(captainDayState(day({ isCaptainOnDay: false, stops: [stop()] }))).toBe('notCaptain');
    expect(captainDayState(day({ isCaptainOnDay: true, stops: [stop()] }))).toBe('hasStops');
  });
});

describe('the current stop is the server’s choice', () => {
  it('is the stop the server named, not the first in the list', () => {
    const stops = [
      stop({ assignmentId: 'a-1', sequence: 1, progress: 'completed' }),
      stop({ assignmentId: 'a-2', sequence: 2, progress: 'current' }),
    ];
    const today = day({ stops, currentAssignmentId: 'a-2' });
    expect(currentStop(today)?.assignmentId).toBe('a-2');
  });

  it('is null when the server names none — a finished day has no current stop', () => {
    expect(currentStop(day({ stops: [stop({ progress: 'completed' })] }))).toBeNull();
  });
});

describe('the action offered mirrors the server’s transition table', () => {
  it('offers exactly one move per execution state', () => {
    expect(nextAction(stop({ executionStatus: 'pending' }))).toBe('start');
    expect(nextAction(stop({ executionStatus: 'active' }))).toBe('pickup');
    expect(nextAction(stop({ executionStatus: 'pickedUp' }))).toBe('deliver');
    expect(nextAction(stop({ executionStatus: 'delivered' }))).toBe('complete');
  });

  it('offers nothing on a settled stop', () => {
    expect(nextAction(stop({ executionStatus: 'completed' }))).toBeNull();
    expect(nextAction(stop({ executionStatus: 'cancelled' }))).toBeNull();
  });

  it('offers NOTHING on a stop that is not current, whatever its execution status', () => {
    // The sequential lock belongs to the server. Offering a move on a locked stop would put a
    // button on screen that the API refuses — the UI must not out-guess the lock.
    expect(nextAction(stop({ progress: 'locked', executionStatus: 'pending' }))).toBeNull();
    expect(nextAction(stop({ progress: 'completed', executionStatus: 'pending' }))).toBeNull();
  });
});

describe('day progress counts what the server marked completed', () => {
  it('counts completed stops out of all stops', () => {
    const stops = [
      stop({ assignmentId: 'a-1', progress: 'completed' }),
      stop({ assignmentId: 'a-2', progress: 'current' }),
      stop({ assignmentId: 'a-3', progress: 'locked' }),
    ];
    expect(dayProgress(day({ stops }))).toEqual({ done: 1, total: 3 });
  });
});

describe('the date in the URL', () => {
  it('passes a real date through and drops anything else, so the server resolves today', () => {
    expect(resolveMyDayDate('2026-08-18')).toBe('2026-08-18');
    expect(resolveMyDayDate(null)).toBeNull();
    expect(resolveMyDayDate('yesterday')).toBeNull();
    expect(resolveMyDayDate('2026-8-1')).toBeNull();
  });
});

describe('the client never names a captain', () => {
  const MOBILE = fileURLToPath(new URL('.', import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(full) && !full.endsWith('.spec.ts') ? [full] : [];
    });
  const SOURCES = [
    ...walk(MOBILE),
    fileURLToPath(new URL('../api/operations-api.ts', import.meta.url)),
    fileURLToPath(new URL('../api/operations-queries.ts', import.meta.url)),
  ];

  /** Comments stripped: the rule is about what the code SENDS, and these files explain why. */
  const code = (file: string): string =>
    readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('sends no captainId or employeeId to identify whose day this is', () => {
    // Not a style rule. The API has no captain parameter at all — identity is resolved from the
    // token server-side — so anything here that looked like one would be a second identity model
    // arriving by the back door.
    for (const file of SOURCES) {
      expect(code(file), file).not.toMatch(/\bcaptainId\b/);
      expect(code(file), file).not.toMatch(/\bmobileUserId\b/);
      expect(code(file), file).not.toMatch(/\bMobileUser\b/);
    }
  });

  it('reads the captain’s name from the server’s answer, not from the auth store', () => {
    const page = code(fileURLToPath(new URL('./CaptainDayPage.tsx', import.meta.url)));
    expect(page).toContain('day.captain');
    // `useMe`/`auth.me` would be the client deciding who the captain is. The server already did.
    expect(page).not.toMatch(/useMe\b/);
    expect(page).not.toMatch(/state\.auth/);
  });

  it('asks my-day with a date and nothing else', () => {
    const api = code(fileURLToPath(new URL('../api/operations-api.ts', import.meta.url)));
    const call = /getMyDay = \(([^)]*)\)/.exec(api);
    expect(call?.[1]?.trim()).toBe('date: string | null');
  });
});
