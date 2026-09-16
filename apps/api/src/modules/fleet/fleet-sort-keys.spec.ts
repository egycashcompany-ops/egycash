// «اسم السائق» as a sort key — a join across the FR-11 line that Fleet is not allowed to write.
//
// The rule being pinned is a boundary rule, and boundary rules fail QUIETLY: nothing breaks if
// Fleet spells `hr_employees` itself, it just becomes a module that reaches into another module's
// collection, and the next person to read it learns that is allowed. So the assertions below are
// about WHERE the collection name comes from, and about what happens when nobody has said.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { registerDirectoryNameSource } from '../../platform/directory';
import { driverNameSort, driverNameSorts } from './fleet-sort-keys';

/**
 * Put the seam back the way a fresh process has it — nothing registered.
 *
 * It is module state, so a test that registered a source would otherwise leak it into the next
 * one, and the fail-closed case would pass for the wrong reason. The cast is the test saying
 * «unregistered», which the seam has no other word for.
 */
const clear = (): void =>
  registerDirectoryNameSource(undefined as unknown as { collection: string; nameField: string });

describe('the driver-name sort key', () => {
  beforeEach(() => {
    clear();
  });

  it('is not published at all while no directory has registered', () => {
    // Fail-closed, like every other lookup on the seam. The alternative — publishing the key and
    // sorting by a field that does not exist — is a page that ignores the arrow while looking as
    // though it obeyed it.
    expect(driverNameSort('driver1Name', 'driver1EmployeeId')).toBeNull();
    expect(
      driverNameSorts([
        ['driver1Name', 'driver1EmployeeId'],
        ['driver2Name', 'driver2EmployeeId'],
      ]),
    ).toEqual([]);
  });

  it('takes the collection and the field from the SEAM, never from Fleet', () => {
    registerDirectoryNameSource({ collection: 'somewhere_else', nameField: 'a.b.c' });
    expect(driverNameSort('driverInName', 'driverInEmployeeId')).toEqual({
      key: 'driverInName',
      from: 'somewhere_else',
      localField: 'driverInEmployeeId',
      pick: 'a.b.c',
    });
  });

  it('joins each driver field on its OWN reference', () => {
    // The two shifts are two columns and two arrows; a single reference would make the second
    // column order by the first driver and read as though it had worked.
    registerDirectoryNameSource({ collection: 'hr', nameField: 'name' });
    const keys = driverNameSorts([
      ['driver1Name', 'driver1EmployeeId'],
      ['driver2Name', 'driver2EmployeeId'],
    ]);
    expect(keys.map((entry) => [entry.key, entry.localField])).toEqual([
      ['driver1Name', 'driver1EmployeeId'],
      ['driver2Name', 'driver2EmployeeId'],
    ]);
  });

  it('names no collection of its own — the string is never written in Fleet', () => {
    // The guard the prose above is about. `hr_employees` appearing anywhere in this module would
    // mean the seam had been bypassed, whatever the surrounding code did with it.
    const source = readFileSync(new URL('./fleet-sort-keys.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('hr_employees');
    expect(source).toContain('getDirectoryNameSource');
  });
});
