// «لو رجعت كل العلامات تتشال» — that the two ways of leaving the board are BOTH closed.
//
// The rule itself is proved against a real mongo in `tests/integration/fleet-licensing.spec.ts`.
// What this file proves is that the two mechanisms are still connected at all, because an
// unwired one fails invisibly: the board keeps working, the ticks keep landing, and the only
// symptom is a car coming back from «م» already half-done — weeks later, on somebody's screen.
//
// Read as TEXT rather than imported. Both files pull in mongoose and the module registry, and all
// this needs from them is which call they make.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = __dirname;
const read = (path: string): string => readFileSync(join(HERE, path), 'utf8');

describe('a car that leaves the licensing board loses its ticks', () => {
  it('the VEHICLE edit voids them when the licence class changes', () => {
    // The car is moved from «برقاش ت» to «برقاش م» through the ordinary registry edit. That write
    // is on the vehicle, so the vehicle service is the only place that can see it happen.
    const source = read('../vehicles/vehicle.service.ts');
    expect(source, 'the repository is reachable from there').toContain(
      'fleetVehicleLicensingRepository',
    );
    const update = source.slice(source.indexOf('  async update('), source.indexOf('  async changeStatus('));
    expect(update, 'and the edit path is the one that calls it').toContain(
      'fleetVehicleLicensingRepository.voidForVehicles',
    );
    expect(update, 'only when the class actually moved').toContain('input.licenseClassId !== undefined');
  });

  it('the BOARD read sweeps the ones a class RENAME took off it', () => {
    // «العجوزة ت» → «العجوزة م» touches the catalog item and not one vehicle document, so there is
    // no write on a car for the hook above to fire on. The read is what notices.
    const source = read('licensing.service.ts');
    const board = source.slice(source.indexOf('async board('), source.indexOf('async setMark('));
    expect(board, 'the sweep runs on the read').toContain('this.sweepVoided(');
    expect(source).toContain('fleetVehicleLicensingRepository.voidForVehicles');
  });

  it('voiding RETIRES the row rather than blanking it', () => {
    // «الداتا اللى ممسوحه متظهرش للمستخدم تبقى فى الداتا بيز فقط». Setting the four booleans back
    // to false would overwrite the record of a finished errand with something indistinguishable
    // from one never started — and would leave the returning car sharing the old row.
    const repo = read('licensing.repository.ts');
    const fn = repo.slice(repo.indexOf('async voidForVehicles('), repo.indexOf('async markedVehicleIds('));
    expect(fn, 'a soft delete').toContain('isDeleted: true');
    for (const mark of ['insuranceHandover', 'insuranceReceipt', 'taxHandover', 'taxReceipt']) {
      expect(fn, `${mark} is not blanked`).not.toContain(`${mark}: false`);
    }
  });

  it('and the sweep asks its question UNSCOPED', () => {
    // "Is this car still on the board" is a fact about the fleet, not about who is looking. Asked
    // under a branch-scoped read it would answer «gone» for every other branch's cars and retire
    // marks nobody touched.
    const repo = read('../vehicles/vehicle.repository.ts');
    const fn = repo.slice(repo.indexOf('async idsOfClasses('));
    expect(fn.slice(0, fn.indexOf('\n  }')), 'no scope reaches the query').not.toContain('scope');
  });
});
