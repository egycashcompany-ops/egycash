// The driving seats are read with only the fields a directory entry is made of.
//
// `drivingSeatRoster()` is asked for every driver on every roster board, on the drivers registry,
// and twice per fleet dashboard refresh (the roster section and the drivers' figures). HR answered
// it with WHOLE employee records — insurance, employment periods, status history — to map each one
// through `toDirectoryEmployee`, which keeps a dozen fields. Two things must hold for the narrower
// read to be the same answer, and neither shows in a behavioural test without a database:
//   • both job-title reads the seam uses ask for `DIRECTORY_FIELDS`;
//   • `DIRECTORY_FIELDS` carries every field `toDirectoryEmployee` reads — a field it missed would
//     come back `undefined` and turn into a silent null (no phone, no governorate) on every screen.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIRECTORY_FIELDS } from '../../hr/employee-management/employees/employee.repository';

const HERE = dirname(fileURLToPath(import.meta.url));
const HR = join(HERE, '../../hr');
const repository = readFileSync(
  join(HR, 'employee-management/employees/employee.repository.ts'),
  'utf8',
);
const seams = readFileSync(join(HR, 'directory-seams.ts'), 'utf8');

/** A method's body, from its signature to the closing brace at method depth. */
const method = (source: string, signature: string): string => {
  const start = source.indexOf(signature);
  expect(start, signature).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('\n  }\n', start));
};

describe('the driving-seat reads ask for a directory entry, not a whole record', () => {
  it.each(['async listByJobTitlesSystem(', 'async listByJobTitlesAnyStatusSystem('])(
    '%s selects DIRECTORY_FIELDS',
    (signature) => {
      expect(method(repository, signature)).toContain('.select(DIRECTORY_FIELDS)');
    },
  );

  it('and the directory seam is their only reader, mapping each row through `toDirectoryEmployee`', () => {
    // A second reader would be handed a partial record typed as a whole one.
    const lookup = seams.slice(seams.indexOf('registerEmployeesByJobTitlesLookup(async'));
    const body = lookup.slice(0, lookup.indexOf('\n  });'));
    expect(body).toContain('employeeRepository.listByJobTitlesAnyStatusSystem(jobTitleIds)');
    expect(body).toContain('employeeRepository.listByJobTitlesSystem(jobTitleIds)');
    expect(body).toContain('employees.map(toDirectoryEmployee)');
  });
});

describe('DIRECTORY_FIELDS carries every field `toDirectoryEmployee` reads', () => {
  const projected = DIRECTORY_FIELDS.split(/\s+/).filter((field) => field !== '');

  /** Every `employee.<path>` the mapper reads, `?.` read as `.`. */
  const reads = (): string[] => {
    const start = seams.indexOf('const toDirectoryEmployee');
    const mapper = seams.slice(start, seams.indexOf('\n};', start));
    const paths = [...mapper.replace(/\?\./g, '.').matchAll(/\bemployee\.([A-Za-z_][\w.]*)/g)].map(
      (match) => (match[1] as string).replace(/\.$/, ''),
    );
    return [...new Set(paths)];
  };

  it('finds the mapper’s reads at all', () => {
    // A broken pattern would find nothing and pass everything below.
    expect(reads()).toEqual(
      expect.arrayContaining([
        'code',
        'status',
        'personal.fullNameAr',
        'personal.contact.primaryPhone',
        'personal.officialAddress',
        'personal.currentAddress',
        'hiredAt',
      ]),
    );
  });

  it('each one is projected — itself, or the subdocument it sits in', () => {
    const covered = (path: string): boolean =>
      path === '_id' || projected.some((field) => path === field || path.startsWith(`${field}.`));
    expect(reads().filter((path) => !covered(path))).toEqual([]);
  });

  it('the two addresses travel whole — the mapper picks one by `??`, so neither may be cut', () => {
    // A projection of `personal.officialAddress.governorate` alone could hand back `{}` or nothing
    // for an address without that line, and `officialAddress ?? currentAddress` would then choose
    // differently than it did on the whole record.
    expect(projected).toContain('personal.officialAddress');
    expect(projected).toContain('personal.currentAddress');
  });
});
