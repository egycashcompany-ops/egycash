// A driver is whoever holds a driving SEAT — never whoever somebody remembered to enrol.
//
// The registry was membership-by-profile: a row existed only if a `FleetDriverProfile` did, and
// the only thing that could create one was `POST /fleet/drivers`, which no screen called after
// «Add Driver» left the UI in PR #257. So the registry showed nothing however many drivers were
// hired, and nothing in the system said why — an empty table looks exactly like an empty fleet.
//
// The roster is now the org chart, through the flag the company already sets on the seat:
// `requiresDrivingTest`, which the job-title form calls "the single place driver-ness is decided"
// and recruitment already reads to decide which documents a candidate is asked for. This pins the
// three things that keeps true, because each can be undone without any test failing on its own.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = resolve(HERE, '../../../..');
const read = (file: string): string => readFileSync(resolve(API, file), 'utf8');
/** Comments explain these rules at length; they must not be able to satisfy them. */
const code = (file: string): string =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

describe('who the drivers registry is made of', () => {
  it('asks the JOB TITLE flag, not a list Fleet keeps', () => {
    const service = code('src/modules/fleet/driver-profiles/driver-profile.service.ts');
    const at = service.indexOf('async listRoster(');
    expect(at, 'the roster method is gone').toBeGreaterThan(-1);
    const body = service.slice(at, service.indexOf('\n  async ', at + 10));
    expect(body, 'the seats that require a driving test').toContain(
      'idsRequiringDrivingTestSystem()',
    );
    expect(body, 'and everyone employed in them').toContain('listDirectoryEmployeesByJobTitles');
  });

  it('reads the flag the rest of the company already sets', () => {
    // Not a new setting. A new one would be unset on every existing system — which is exactly how
    // Operations' crew roster came to show one driver and no captains (PR #375).
    const repo = code('src/platform/organization/job-titles/job-title.repository.ts');
    expect(repo).toContain('requiresDrivingTest: true');
    // The same flag recruitment calls `isDriver`.
    expect(code('src/modules/hr/recruitment/materializer/queue-materializer.service.ts')).toContain(
      'requiresDrivingTest',
    );
  });

  it('excludes inactive seats and people who have left', () => {
    // A retired job title has no current occupant to put on the road; an exited employee is not a
    // driver. Both are filtered at the source rather than by each consumer remembering to.
    expect(code('src/platform/organization/job-titles/job-title.repository.ts')).toContain(
      "status: 'active'",
    );
    expect(
      code('src/modules/hr/employee-management/employees/employee.repository.ts'),
    ).toContain('listByJobTitlesSystem');
    const employees = code('src/modules/hr/employee-management/employees/employee.repository.ts');
    const at = employees.indexOf('listByJobTitlesSystem');
    expect(employees.slice(at, at + 500)).toContain('EMPLOYED_STATUSES');
  });

  it('crosses the FR-11 line through the seam, never by importing HR', () => {
    // Fleet may not read HR's collection. It asks the platform directory, exactly as it already
    // does for one employee at a time.
    const service = read('src/modules/fleet/driver-profiles/driver-profile.service.ts');
    expect(service).toContain("from '../../../platform/directory'");
    expect(service, 'Fleet importing HR would be the boundary breaking').not.toContain(
      "from '../../hr/",
    );
  });

  it('hands the list endpoint a PERSON, whose profile may be null', () => {
    const controller = code('src/modules/fleet/driver-profiles/driver-profile.controller.ts');
    const at = controller.indexOf('listDriverProfiles');
    const body = controller.slice(at, controller.indexOf('};', at));
    expect(body).toContain('listRoster');
    expect(body, 'a driver nobody has recorded anything about still gets a row').toContain(
      'row.profile === null ? null :',
    );
  });
});

describe('the enrolment path that had no caller', () => {
  it('the create endpoint is reachable from a screen again', () => {
    // `useCreateDriverProfile` existed and nothing called it — the hook, the client function and
    // the endpoint were all standing, with no way in. The form now uses it for a driver whose
    // licence has never been recorded.
    const WEB = resolve(API, '../web/src');
    const dialog = readFileSync(
      resolve(WEB, 'modules/fleet/components/DriverFormDialog.tsx'),
      'utf8',
    );
    expect(dialog).toContain('useCreateDriverProfile');
    expect(dialog, 'and it creates only when there is nothing to update').toContain(
      'if (profile === null)',
    );
  });
});
