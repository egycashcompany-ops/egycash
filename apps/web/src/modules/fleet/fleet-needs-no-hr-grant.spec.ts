// A FLEET OPERATOR SEES FLEET'S PEOPLE, AND NEEDS NOTHING FROM HR TO DO IT.
//
// «انا عاوز اعرض السواقيين بتوع الحركه للناس اللى واخده موديول الحركه بس ... عشان يظهر لازم اخش
// اديله من الاتش ار صفحه الموظفون ف بيعرض ... كل المواظفين بتوع الشركه لا انا عاوز الحركه يظهر
// الناس بتاعت الحركه بس».
//
// Every Fleet screen that prints a driver used to read HR's employee endpoint under HR's own
// `employee.view`, and that grant is the whole directory: giving a dispatcher the names on their
// own board also gave them «الموظفون» and every employee in the company.
//
// This is a SOURCE-LEVEL guard because that is the shape of the rule. Nothing renders wrongly when
// it breaks — a screen that quietly starts asking HR again looks perfectly fine to whoever has
// both grants, and the regression is invisible until somebody hands a Fleet-only operator a
// permission nobody meant them to have.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = __dirname;

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.tsx?$/u.test(entry.name) && !/\.spec\.tsx?$/u.test(entry.name) ? [full] : [];
  });

/** Source with comments stripped: a rule about the code must not be satisfied — or broken — by prose. */
const code = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

/**
 * The files allowed to mention HR's grant, and why each one is not «printing a name».
 *
 *   • `DriverFormDialog` SAVES a driver's phone back into HR. An optimistic write needs the HR
 *     document's own `version`, so it reads one — under `employee.editPersonal`, the very grant
 *     the save requires. A reader without it does not get the box.
 *   • `hr-delegation.ts` declares LINKS into HR's own screens, each with the route permission that
 *     screen already enforces. A link nobody may follow is hidden; none of it reads a record.
 *   • `DriverProfilePage` hides its «open the HR profile» link from a reader who cannot open it,
 *     which is that same rule applied to one anchor.
 */
const ALLOWED = [
  'components/DriverFormDialog.tsx',
  'components/hr-delegation.ts',
  'pages/DriverProfilePage.tsx',
];

describe('no Fleet screen reads HR’s directory to print a name', () => {
  const offenders = files(HERE)
    .filter((path) => !ALLOWED.some((rel) => path.endsWith(rel)))
    .filter((path) => /getEmployee\(|listEmployees\(|'employee\.view'/u.test(code(path)))
    .map((path) => path.slice(HERE.length + 1));

  it('asks Fleet’s own roster instead — no `getEmployee`, no `listEmployees`, no `employee.view`', () => {
    expect(offenders).toEqual([]);
  });

  it('and the exceptions are named, so the list cannot quietly grow', () => {
    // Every entry here is a place a Fleet-only operator loses something — a phone box, a link —
    // rather than a place they are blocked. A fourth one is a decision somebody has to make.
    expect(ALLOWED).toEqual([
      'components/DriverFormDialog.tsx',
      'components/hr-delegation.ts',
      'pages/DriverProfilePage.tsx',
    ]);
    const dialog = code(join(HERE, 'components/DriverFormDialog.tsx'));
    expect(dialog, 'the one that reads does so under the grant its SAVE needs').toContain(
      'mayEditPhone',
    );
    expect(dialog).toContain("can('employee.editPersonal')");
    // The other two only DECIDE WHETHER TO SHOW A LINK — neither fetches a record.
    for (const rel of ['components/hr-delegation.ts', 'pages/DriverProfilePage.tsx']) {
      expect(code(join(HERE, rel)), rel).not.toMatch(/getEmployee\(|listEmployees\(/u);
    }
  });
});

describe('the roster it reads instead', () => {
  it('is Fleet’s own endpoint, under Fleet’s own grant', () => {
    const api = code(join(HERE, 'api/fleet-api.ts'));
    expect(api, 'a Fleet endpoint').toContain("get<FleetPersonDto[]>('/fleet/people')");
    const names = code(join(HERE, 'components/EmployeeName.tsx'));
    expect(names, 'gated on the drivers’ view grant').toContain("can('fleetDriver.view')");
  });

  it('is ONE request for a whole board, not one per cell', () => {
    // The old shape fanned out per employee id — a hundred requests for a hundred rows. The list
    // is shared by every cell, which is what makes it affordable to hold the whole roster.
    const names = code(join(HERE, 'components/EmployeeName.tsx'));
    expect(names, 'one query').toContain('useFleetPeople(');
    expect(names, 'no fan-out').not.toContain('useQueries(');
  });
});
