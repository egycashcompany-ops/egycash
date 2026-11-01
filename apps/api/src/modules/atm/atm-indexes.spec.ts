// The boot index builder's report for a collection whose rows stay out of the log — the two
// operation logs since the owner's rule (port doc OD-1). Legacy data may hold two open rows for
// one machine, so their unique index is the likeliest to be reported; the report must name the
// collection and the counts, never a machine code, a row id or a server message quoting a key.
import { describe, expect, it } from 'vitest';
import { atmIndexedModels, duplicateCounts, redactedErrorText } from './atm-indexes';

describe('duplicateCounts', () => {
  it('reduces the duplicate groups to how many and how many rows', () => {
    const groups = [
      { rows: 2, key: { machineCode: '101' }, docIds: ['a', 'b'] },
      { rows: 3, key: { machineCode: '102' }, docIds: ['c', 'd', 'e'] },
    ];
    expect(duplicateCounts(groups)).toEqual({ groups: 2, rows: 5 });
  });

  it('carries nothing else — no key, no id', () => {
    const groups = [{ rows: 2, key: { machineCode: '101' } }];
    const counted = duplicateCounts(groups);
    expect(Object.keys(counted).sort()).toEqual(['groups', 'rows']);
    expect(JSON.stringify(counted)).not.toContain('101');
  });
});

describe('redactedErrorText', () => {
  it('keeps the error’s name and server code, and drops a message that quotes a key', () => {
    const error = Object.assign(
      new Error('E11000 duplicate key error … dup key: { machineCode: "101" }'),
      { name: 'MongoServerError', code: 11000 },
    );
    expect(redactedErrorText(error)).toBe('MongoServerError 11000');
    expect(redactedErrorText(error)).not.toContain('101');
  });

  it('falls back to the name alone, and survives a non-Error', () => {
    expect(redactedErrorText(new TypeError('quoted 101'))).toBe('TypeError');
    expect(redactedErrorText('quoted 101')).toBe('Error');
    expect(redactedErrorText(null)).toBe('Error');
  });
});

describe('atmIndexedModels', () => {
  // The bank catalog (DEC-35): its unique code and label-key indexes must exist before the boot
  // seed writes the six; codes and label keys are not K/S values, so its rows may be logged.
  it('lists the bank catalog with its rows allowed in the log', () => {
    const listed = new Map(atmIndexedModels().map((entry) => [entry.collection, entry.rowsInLog]));
    expect(listed.get('atm_banks')).toBe(true);
  });

  // The machine map (docs/12-planning/atm-map-zones.md §3.4): its keys are ids, never K/S values.
  it('lists the map collections with their rows allowed in the log', () => {
    const listed = new Map(atmIndexedModels().map((entry) => [entry.collection, entry.rowsInLog]));
    for (const collection of ['atm_map_zones', 'atm_map_zone_sets', 'atm_machine_locations']) {
      expect(listed.get(collection), collection).toBe(true);
    }
  });

  // Settlements phase 1 (docs/12-planning/atm-settlements-phase1.md §4.10): all ten are built at
  // boot; the three operation records keep their rows out of the log.
  it('lists the ten settlements collections, the operation records with their rows kept out', () => {
    const listed = new Map(atmIndexedModels().map((entry) => [entry.collection, entry.rowsInLog]));
    for (const collection of [
      'atm_cassette_layouts',
      'atm_cassette_layout_versions',
      'atm_standard_loads',
      'atm_replenishment_plans',
      'atm_dispatch_routes',
      'atm_layout_import_runs',
      'atm_note_counters',
    ]) {
      expect(listed.get(collection), collection).toBe(true);
    }
    for (const collection of ['atm_plan_lines', 'atm_line_preparations', 'atm_route_assignments']) {
      expect(listed.get(collection), collection).toBe(false);
    }
  });

  // /atm/settings: `ux_mailbox_key` is what turns a second "first save" into a stale 409 instead
  // of a second mailbox. Its key is a fixed word, so its rows may be logged.
  it('lists the mailbox document with its rows allowed in the log', () => {
    const listed = new Map(atmIndexedModels().map((entry) => [entry.collection, entry.rowsInLog]));
    expect(listed.get('atm_mailbox_config')).toBe(true);
  });

  // «نقل البيانات»: `ux_one_running` is the lock that keeps two moves from merging one source twice;
  // it must exist in production, where nothing else builds it. A run holds ids and counts only.
  it('lists the branch-move runs with their rows allowed in the log', () => {
    const listed = new Map(atmIndexedModels().map((entry) => [entry.collection, entry.rowsInLog]));
    expect(listed.get('atm_branch_move_runs')).toBe(true);
  });
});
