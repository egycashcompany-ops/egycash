// The owner's rule (2026-10-13, per day since 2026-10-27 — port doc OD-1), lifted for
// replenishments 2026-11-01 (OD-1b) and for maintenance 2026-11-02 (OD-1c): neither operation
// schema declares an open-operation index any more, and the boot drops the ones older databases
// built. What the maintenance log declares instead is one live maintenance per MAIL TICKET — the
// race-proof half of a mail accepted twice at once — and how its refusal is recognized.
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@ecms/contracts';
import { BusinessRuleError, ConflictError, StaleDocumentError } from '../../../shared/errors';
import { AtmReplenishmentModel } from '../replenishments/replenishment.model';
import {
  AtmMaintenanceModel,
  MAINTENANCE_PER_MAIL_TICKET_INDEX_NAME,
  maintenancePerMailTicketFilter,
} from '../maintenances/maintenance.model';
import { isMailTicketTaken } from '../maintenances/maintenance.service';
import { atmIndexBuildPlan, atmIndexedModels } from '../atm-indexes';
import { leaderCascadeGroups } from './operation-log.repository';
import { RETIRED_OPEN_OPERATION_INDEX_NAMES, openDayOf } from './open-operation';
import { Types } from 'mongoose';

describe('no open-operation index on either log — a machine may have several open (OD-1b, OD-1c)', () => {
  it('replenishment: no unique index at all', () => {
    const plan = atmIndexBuildPlan(AtmReplenishmentModel.schema.indexes());
    expect(plan.filter((p) => p.unique)).toEqual([]);
  });

  it('maintenance: its ONE unique index is per mail ticket — over live rows opened from a ticket', () => {
    const plan = atmIndexBuildPlan(AtmMaintenanceModel.schema.indexes());
    const unique = plan.filter((p) => p.unique);
    expect(unique.map((p) => p.options['name'])).toEqual([MAINTENANCE_PER_MAIL_TICKET_INDEX_NAME]);
    expect(MAINTENANCE_PER_MAIL_TICKET_INDEX_NAME).toBe('ux_maintenance_per_mail_ticket');
    expect(unique[0]?.keys).toEqual({ mailTicketId: 1 });
    // Closed rows are covered (no `closedAt` in the filter); deleted rows and rows with no ticket
    // (`mailTicketId: null` — every manual and imported row) are not.
    expect(unique[0]?.options['partialFilterExpression']).toEqual({
      mailTicketId: { $type: 'objectId' },
      isDeleted: false,
    });
  });

  it.each([
    ['replenishment', AtmReplenishmentModel],
    ['maintenance', AtmMaintenanceModel],
  ] as const)(
    '%s: keeps the non-unique open-rows index the mail duplication question runs on',
    (_kind, model) => {
      const plan = atmIndexBuildPlan(model.schema.indexes());
      const entry = plan.find((p) => p.options['name'] === 'ix_open_code_opened');
      expect(entry?.keys).toEqual({ machineCode: 1, openedAt: 1 });
      expect(entry?.unique).toBe(false);
    },
  );

  it.each([
    ['replenishment', AtmReplenishmentModel],
    ['maintenance', AtmMaintenanceModel],
  ] as const)('%s: no retired index is declared any more', (kind, model) => {
    const plan = atmIndexBuildPlan(model.schema.indexes());
    for (const name of RETIRED_OPEN_OPERATION_INDEX_NAMES[kind]) {
      expect(plan.some((p) => p.options['name'] === name)).toBe(false);
    }
  });

  it('lists the retired indexes on each operation log for the boot to drop — the per-day forms included', () => {
    const retired = Object.fromEntries(
      atmIndexedModels().map((entry) => [entry.collection, entry.retired ?? []]),
    );
    expect(retired['atm_replenishments']).toEqual([
      'ux_open_replenishment_per_code',
      'ux_open_replenishment_per_code_day',
    ]);
    expect(retired['atm_maintenances']).toEqual([
      'ux_open_maintenance_per_code',
      'ux_open_maintenance_per_code_day',
    ]);
  });

  it('hands the schema its own filter object', () => {
    expect(maintenancePerMailTicketFilter()).not.toBe(maintenancePerMailTicketFilter());
  });

  it('is built at boot: both collections are on the index builder’s list, rows kept out of its log', () => {
    const listed = atmIndexedModels().filter((entry) =>
      ['atm_replenishments', 'atm_maintenances'].includes(entry.collection),
    );
    expect(listed.map((entry) => entry.collection).sort()).toEqual([
      'atm_maintenances',
      'atm_replenishments',
    ]);
    expect(listed.every((entry) => !entry.rowsInLog)).toBe(true);
    // The settlements' operation records join them (docs/12-planning/atm-settlements-phase1.md
    // §4.10): plan lines, line preparations and route assignments hold counts and seals. Every
    // other collection — the master, the register — keeps its report exactly as before.
    const rowsOut = [
      'atm_line_preparations',
      'atm_maintenances',
      'atm_plan_lines',
      'atm_replenishments',
      'atm_route_assignments',
    ];
    expect(
      atmIndexedModels()
        .filter((entry) => !entry.rowsInLog)
        .map((entry) => entry.collection)
        .sort(),
    ).toEqual(rowsOut);
    expect(
      atmIndexedModels()
        .filter((entry) => !rowsOut.includes(entry.collection))
        .every((entry) => entry.rowsInLog),
    ).toBe(true);
  });
});

describe('a mail accepted twice at once — the per-ticket index’s refusal, recognized', () => {
  it('is the DUPLICATE create maps E11000 to, and nothing else', () => {
    // `create` maps E11000 to a DUPLICATE ConflictError (base.repository.ts); on the maintenance
    // log the per-ticket index is the only unique index besides `_id`.
    expect(isMailTicketTaken(new ConflictError())).toBe(true);
    expect(
      isMailTicketTaken(
        new ConflictError('another record already holds this mailTicketId', ErrorCodes.DUPLICATE),
      ),
    ).toBe(true);
    expect(isMailTicketTaken(new ConflictError('x', ErrorCodes.ATM_OPERATION_ALREADY_OPEN))).toBe(
      false,
    );
    expect(isMailTicketTaken(new StaleDocumentError())).toBe(false);
    expect(isMailTicketTaken(new BusinessRuleError('x'))).toBe(false);
    expect(isMailTicketTaken({ code: 11000 })).toBe(false);
    expect(isMailTicketTaken(new Error('boom'))).toBe(false);
    expect(isMailTicketTaken(null)).toBe(false);
  });
});

describe('the day an operation belongs to', () => {
  it('is the Cairo calendar day of the open time, not the UTC one', () => {
    // 23:30Z on the 26th is 01:30 (EET) or 02:30 (EEST) on the 27th in Cairo.
    expect(openDayOf(new Date('2026-10-26T23:30:00.000Z'))).toBe('2026-10-27');
    expect(openDayOf(new Date('2026-10-27T09:00:00.000Z'))).toBe('2026-10-27');
  });
});

describe('leaderCascadeGroups — one cascade per branch, area and shift', () => {
  const branch = new Types.ObjectId();
  const at = (iso: string, area = 'Smouha', branchId = branch) => ({
    branchId,
    area,
    openedAt: new Date(iso),
  });

  it('keeps the first row of each group and drops the rest', () => {
    const rows = [
      at('2026-10-27T08:00:00.000Z'), // 10:00 Cairo — day shift
      at('2026-10-27T10:00:00.000Z'), // 12:00 — the same day shift
      at('2026-10-27T15:00:00.000Z'), // 17:00 — the night shift
      at('2026-10-27T08:00:00.000Z', 'Miami'), // another area
      at('2026-10-27T08:00:00.000Z', 'Smouha', new Types.ObjectId()), // another branch
    ];
    expect(leaderCascadeGroups(rows)).toEqual([rows[0], rows[2], rows[3], rows[4]]);
  });
});
