// `ux_fixed_vehicle` — the index that makes "one vehicle, one fixed crew" a database fact.
//
// The service checks exclusivity against the end state of the board, but that check runs in
// application code: two concurrent saves can both read a board without the row and both decide to
// insert. The unique index is what makes the second one lose. So the DEFINITION is load-bearing,
// and it is asserted here rather than only in an integration test, because the thing that breaks
// it is a one-word edit — dropping `unique` — that a typecheck cannot see and that a database
// with no concurrent writers would never surface.
//
// `autoIndex` is off outside development, so production builds this index from a migration
// instead of from the schema. That is two places holding one definition, and mongo answers a
// mismatched rebuild with IndexOptionsConflict rather than a fix — so the definition lives in one
// pair of exported constants and both places read them. These tests pin that arrangement.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FIXED_CREW_VEHICLE_INDEX_KEY,
  FIXED_CREW_VEHICLE_INDEX_OPTIONS,
  FleetFixedCrewModel,
} from './fixed-crew.model';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(HERE, '../fleet.migration.ts'), 'utf8');

/** The index declarations the schema carries, as mongoose will hand them to the driver. */
const declared = () => FleetFixedCrewModel.schema.indexes();

describe('the fixed-crew vehicle index', () => {
  it('is declared on the schema, by name', () => {
    const names = declared().map(([, options]) => (options as { name?: string }).name);
    expect(names).toContain('ux_fixed_vehicle');
  });

  it('is UNIQUE — without that word the collection allows two crews for one car', () => {
    const entry = declared().find(([, o]) => (o as { name?: string }).name === 'ux_fixed_vehicle');
    expect(entry, 'the index is declared').toBeDefined();
    const [key, options] = entry as [Record<string, unknown>, Record<string, unknown>];
    expect(key).toEqual({ vehicleId: 1 });
    expect(options.unique, 'unique').toBe(true);
  });

  it('is PARTIAL on live rows, so a soft-deleted row cannot hold a live vehicle’s slot', () => {
    const entry = declared().find(([, o]) => (o as { name?: string }).name === 'ux_fixed_vehicle');
    const [, options] = entry as [Record<string, unknown>, Record<string, unknown>];
    expect(options.partialFilterExpression).toEqual({ isDeleted: false });
  });

  it('declares exactly ONE index of its own — nothing else was added by accident', () => {
    expect(declared()).toHaveLength(1);
  });

  // ── one definition, two builders ─────────────────────────────────────────

  it('the schema is built from the exported constants, not a copy of them', () => {
    const entry = declared().find(([, o]) => (o as { name?: string }).name === 'ux_fixed_vehicle');
    const [key, options] = entry as [Record<string, unknown>, Record<string, unknown>];
    expect(key).toEqual(FIXED_CREW_VEHICLE_INDEX_KEY);
    // Mongoose adds `background` of its own; every option WE declare must be carried verbatim.
    for (const [k, v] of Object.entries(FIXED_CREW_VEHICLE_INDEX_OPTIONS)) {
      expect(options[k], `option ${k}`).toEqual(v);
    }
  });

  it('the production migration builds the SAME definition, by reference', () => {
    // A hand-written second copy is the failure mode this guards: it would drift, and mongo
    // answers a drifted rebuild with IndexOptionsConflict instead of correcting itself.
    expect(MIGRATION).toContain('FIXED_CREW_VEHICLE_INDEX_KEY');
    expect(MIGRATION).toContain('FIXED_CREW_VEHICLE_INDEX_OPTIONS');
    expect(MIGRATION, 'no literal re-declaration').not.toMatch(/name:\s*'ux_fixed_vehicle'/);
    expect(MIGRATION, 'and no second unique: true').not.toMatch(/unique:\s*true/);
  });

  it('runs on every boot, through the module’s own migration hook', () => {
    expect(MIGRATION).toMatch(/runFleetMigrations[\s\S]*migrateFixedCrewIndex\(\)/);
  });

  // ── duplicates are reported, never resolved ──────────────────────────────

  it('looks for duplicates BEFORE building, under the index’s own filter', () => {
    const fn = MIGRATION.slice(
      MIGRATION.indexOf('export const migrateFixedCrewIndex'),
      MIGRATION.indexOf('export const runFleetMigrations'),
    );
    expect(fn, 'grouped by the indexed field').toContain("$group: { _id: '$vehicleId'");
    expect(fn, 'under the partial filter').toContain('$match: { isDeleted: false }');
    // The check must come first, or it is not a check.
    expect(fn.indexOf('aggregate')).toBeLessThan(fn.indexOf('createIndex'));
  });

  it('never deletes or merges a duplicate — it reports and stops', () => {
    const fn = MIGRATION.slice(
      MIGRATION.indexOf('export const migrateFixedCrewIndex'),
      MIGRATION.indexOf('export const runFleetMigrations'),
    );
    expect(fn).not.toMatch(/deleteOne|deleteMany|findOneAndDelete|updateOne|updateMany|bulkWrite/);
    expect(fn, 'the operator is told which vehicles').toContain('vehicleId: String(d._id)');
    expect(fn, 'and the index is not built').toContain('created: false');
  });

  it('touches no other collection', () => {
    const fn = MIGRATION.slice(
      MIGRATION.indexOf('export const migrateFixedCrewIndex'),
      MIGRATION.indexOf('export const runFleetMigrations'),
    );
    const models = [...fn.matchAll(/(\w*Model)\.collection/g)].map((m) => m[1]);
    expect([...new Set(models)]).toEqual(['FleetFixedCrewModel']);
  });
});
