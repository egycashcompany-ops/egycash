// Structural invariants for the Attendance surface (AT-6). Each guards a mistake that renders
// perfectly well and is still wrong.
//
// 1. **Every administrative route is permission-gated**, with the same key its server route
//    checks. My Attendance is the deliberate exception — the My Leave precedent: it needs an
//    authenticated employee login rather than a permission, because the endpoints behind it are
//    own-scope BY CONSTRUCTION and cannot be pointed at another employee.
// 2. **Navigation never links to a route that does not exist**, and never advertises a screen the
//    row's own key would not open (the Fleet FW-1 rule).
// 3. **Nothing on these screens can carry money.** Attendance is quantities (§1); pricing is
//    Payroll's. A rate or an amount appearing here would be an architecture breach that no
//    rendering test would ever catch.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(resolve(HERE, 'routes.tsx'), 'utf8');
const SEED = readFileSync(resolve(HERE, '../../../../../api/src/seed-navigation.ts'), 'utf8');
const SOURCES = [
  'pages/DailySheetPage.tsx',
  'pages/EmployeeMonthPage.tsx',
  'pages/MyAttendancePage.tsx',
  'pages/RegularizationQueuePage.tsx',
  'components/DaysTable.tsx',
  'components/MonthGrid.tsx',
  'components/RegularizationsTable.tsx',
  'components/OvertimeApprovalDialog.tsx',
  'components/EmployeeAttendanceTab.tsx',
].map((file) => [file, readFileSync(resolve(HERE, file), 'utf8')] as const);

const declaredPaths = (): string[] =>
  [...ROUTES.matchAll(/path="([^"*]+)"/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));

describe('Attendance routes', () => {
  const paths = declaredPaths();

  it('declares the AT-1 + AT-6 surface and nothing unshipped', () => {
    expect(paths.sort()).toEqual(
      ['assignments', 'daily', 'employees/:id', 'me', 'regularizations', 'shifts'].sort(),
    );
  });

  it('gates every administrative route behind its permission, and only My Attendance without one', () => {
    const guarded = [...ROUTES.matchAll(/<RequirePermission permission="([^"]+)">/g)].map(
      (m) => m[1],
    );
    // daily + employees/:id share one guard (an Outlet), so four guards cover five admin routes.
    expect(guarded.sort()).toEqual(
      [
        'attendance.assign',
        'attendance.decideRegularization',
        'attendance.manageShifts',
        'attendance.view',
      ].sort(),
    );
    // `me` and the index render My Attendance with no permission — deliberately.
    expect(ROUTES).toContain('<Route index element={<MyAttendancePage />} />');
    expect(ROUTES).toContain('<Route path="me" element={<MyAttendancePage />} />');
  });

  it('reads the daily sheet and the employee month under the same key the API checks', () => {
    // Both hit GET /hr/attendance/days, which authorizes `attendance.view` and scopes by it.
    const outlet = ROUTES.slice(ROUTES.indexOf('attendance.view'));
    expect(outlet).toContain('path="daily"');
    expect(outlet).toContain('path="employees/:id"');
  });

  it('gates on attendance keys only — never on another module’s', () => {
    for (const [, source] of [...SOURCES, ['routes.tsx', ROUTES] as const]) {
      for (const match of source.matchAll(/permission="([^"]+)"/g)) {
        const key = match[1] ?? '';
        expect(
          key.startsWith('attendance.') || key.startsWith('branch.') || key.startsWith('section.'),
          `${key} is not an attendance (or org-lookup) key`,
        ).toBe(true);
      }
    }
  });

  // The decision buttons are the two-step chain's UI. They may only be offered on a PENDING
  // request; the server refuses the rest, and offering them would be a promise it breaks.
  it('offers a decision only while a request is pending', () => {
    const table = SOURCES.find(([file]) => file.endsWith('RegularizationsTable.tsx'))?.[1] ?? '';
    expect(table).toContain("r.status === 'pendingManager' || r.status === 'pendingHr'");
  });

  // §1/D5: Attendance is quantities. Not one of these screens may name a price. Comments are
  // stripped first — the ban is on what the screen DOES, and the prose above says "no rate" a
  // lot, which is the opposite of a violation.
  it('never renders money, a rate or a multiplier', () => {
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');
    for (const [file, source] of SOURCES) {
      expect(stripComments(source), `${file} must not price anything`).not.toMatch(
        /formatMoney|currency|EGP|salary|\brate\b|multiplier|payslip/i,
      );
    }
  });

  // The overtime dialog releases MINUTES and shows the derived ceiling; the server holds the same
  // bound. A screen that let a user ask for more would only produce a 422.
  it('bounds the overtime dialog by the derived minutes', () => {
    const dialog = SOURCES.find(([file]) => file.endsWith('OvertimeApprovalDialog.tsx'))?.[1] ?? '';
    expect(dialog).toContain('parsed > day.overtimeMinutes');
    expect(dialog).toContain('max={day.overtimeMinutes}');
  });

  // My Attendance must never read the scoped endpoints: `/me` is the whole own-scope guarantee.
  it('keeps My Attendance on the own-scope endpoints only', () => {
    const page = SOURCES.find(([file]) => file.endsWith('MyAttendancePage.tsx'))?.[1] ?? '';
    expect(page).toContain('useMyAttendanceDays');
    expect(page).toContain('useMyRegularizations');
    expect(page).not.toContain('useAttendanceDays(');
    expect(page).not.toContain('employeeId:');
  });
});

describe('Attendance navigation matches the routes that exist', () => {
  const navRows = [...SEED.matchAll(/route:\s*'(\/attendance[^']*)'/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
  const paths = declaredPaths();

  it('points every attendance row at a declared route', () => {
    expect(navRows.length).toBeGreaterThan(0);
    for (const route of navRows) {
      expect(paths, `${route} has no route`).toContain(route.replace('/attendance/', ''));
    }
  });

  it('carries a row for each of the four administrative screens', () => {
    expect(navRows.sort()).toEqual(
      [
        '/attendance/daily',
        '/attendance/regularizations',
        '/attendance/shifts',
        '/attendance/assignments',
      ].sort(),
    );
  });

  // My Attendance is reachable by every employee login, so a permission-keyed row would either
  // advertise it to nobody or demand a key it does not need. My Leave has none either.
  it('gives self-service no navigation row', () => {
    expect(navRows).not.toContain('/attendance/me');
  });
});
