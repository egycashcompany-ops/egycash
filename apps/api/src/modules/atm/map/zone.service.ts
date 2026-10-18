// Saving one branch's zones — every change of an editing session in one request, under the
// revision the editor loaded (docs/12-planning/atm-map-zones.md §6.5 "Zone-set save", DM-7, DM-8,
// DM-12, DM-37).
//
// WHERE: the branch is resolved on the server (`resolveZoneEditBranch`) — the top bar's when the
// caller can read and edit it, else the caller's only editable branch. The body's `branchId` is a
// consistency check only: a tab whose top-bar choice changed in another tab must never save one
// branch's draft over another branch (400 `BRANCH_MISMATCH`).
//
// HOW: everything is validated against the branch's live zones first, then ONE transaction moves
// the set's revision by compare-and-set and writes. A revision that moved is 409
// `ATM_MAP_ZONES_STALE` and writes nothing. Names are unique per branch here, under that CAS, not
// by an index: one save may swap two names, and an index would refuse the state in between.
//
// AUDITS are built inside the transaction callback — fresh on every run, because `withTransaction`
// may run it more than once — and recorded once, after the commit. A pure reorder is audited too:
// under D-M7 the order decides which zone a machine counts for.
import {
  ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX,
  ATM_MAP_ZONES_PER_BRANCH_MAX,
  ErrorCodes,
  zoneGeometryIssues,
  type ApiErrorDetail,
  type AtmMapLatLng,
  type AtmMapZoneSetDto,
  type SaveAtmMapZoneSet,
} from '@ecms/contracts';
import { Types, type ClientSession } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../../../shared/errors';
import { keyReachesBranch, type AuthContext } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { type PendingAudit } from '../register/register-coupling';
import { toZoneSetDto } from './map.service';
import { resolveZoneEditBranch } from './map-scope';
import { AtmMapZoneSetModel } from './zone-set.model';
import { AtmMapZoneModel, type AtmMapZoneDoc } from './zone.model';

/** DM-8: names compare after trimming, collapsing spaces and case-folding. */
export const zoneNameKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** The zone's audit snapshot (§6.5 step 4). */
const zoneSnapshot = (
  zone: Pick<AtmMapZoneDoc, 'branchId' | 'name' | 'color' | 'order' | 'points'>,
) => ({
  branchId: String(zone.branchId),
  name: zone.name,
  color: zone.color,
  order: zone.order,
  points: zone.points.map((p) => [p.lat, p.lng]),
});

const zoneRef = (id: string) => ({ moduleId: 'atm', entityType: 'mapZone', entityId: id });

const stale = (): ConflictError =>
  new ConflictError(
    'the zones changed since they were loaded — reload them',
    ErrorCodes.ATM_MAP_ZONES_STALE,
  );

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

const recordAll = async (audits: readonly PendingAudit[]): Promise<void> => {
  for (const audit of audits) await auditService.record(audit);
};

/** A zone of the final set, with where in the body it came from (null = untouched). */
interface FinalZone {
  key: string;
  name: string;
  points: readonly AtmMapLatLng[];
  namePath: string | null;
}

/** Step 2: every check against the branch's live zones. Throws one 400 with every detail. */
const validateSave = (save: SaveAtmMapZoneSet, live: readonly AtmMapZoneDoc[]): void => {
  const details: ApiErrorDetail[] = [];
  const issue = (field: string, code: string, message: string): void => {
    details.push({ field, code, message });
  };
  const liveIds = new Set(live.map((z) => String(z._id)));

  save.updates.forEach((update, i) => {
    if (!liveIds.has(update.id)) {
      issue(`body.updates.${String(i)}.id`, 'UNKNOWN_ZONE', 'no such zone in this branch');
    }
  });
  save.deletes.forEach((id, i) => {
    if (!liveIds.has(id))
      issue(`body.deletes.${String(i)}`, 'UNKNOWN_ZONE', 'no such zone in this branch');
  });

  const deleted = new Set(save.deletes);
  const expected = [
    ...live.map((z) => String(z._id)).filter((id) => !deleted.has(id)),
    ...save.creates.map((c) => c.tempId),
  ];
  const given = new Set(save.order);
  if (
    save.order.length !== expected.length ||
    given.size !== save.order.length ||
    expected.some((id) => !given.has(id))
  ) {
    issue('body.order', 'ORDER_MISMATCH', 'the order must list every remaining zone exactly once');
  }
  if (expected.length > ATM_MAP_ZONES_PER_BRANCH_MAX) {
    issue(
      'body.creates',
      'TOO_MANY_ZONES',
      `at most ${String(ATM_MAP_ZONES_PER_BRANCH_MAX)} zones`,
    );
  }

  // The final set: live zones with their updates applied, minus the deletes, plus the creates.
  const updateOf = new Map(save.updates.map((u, i) => [u.id, { update: u, i }]));
  const finals: FinalZone[] = [
    ...live
      .filter((z) => !deleted.has(String(z._id)))
      .map((z): FinalZone => {
        const entry = updateOf.get(String(z._id));
        return {
          key: String(z._id),
          name: entry?.update.name ?? z.name,
          points: entry?.update.points ?? z.points,
          namePath:
            entry?.update.name === undefined ? null : `body.updates.${String(entry.i)}.name`,
        };
      }),
    ...save.creates.map((c, i): FinalZone => ({
      key: c.tempId,
      name: c.name,
      points: c.points,
      namePath: `body.creates.${String(i)}.name`,
    })),
  ];
  const totalPoints = finals.reduce((sum, z) => sum + z.points.length, 0);
  if (totalPoints > ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX) {
    issue(
      'body',
      'TOO_MANY_POINTS_IN_BRANCH',
      `at most ${String(ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX)} points in one branch`,
    );
  }

  const byName = new Map<string, FinalZone[]>();
  for (const zone of finals) {
    const key = zoneNameKey(zone.name);
    byName.set(key, [...(byName.get(key) ?? []), zone]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    // Blame the names this save wrote; an untouched pair (legacy) is blamed on its second row.
    const blamed = group.filter((z) => z.namePath !== null);
    for (const zone of blamed.length > 0 ? blamed : group.slice(1)) {
      issue(
        zone.namePath ?? 'body.order',
        'DUPLICATE_NAME',
        'another zone of this branch has this name',
      );
    }
  }

  const geometry = (path: string, points: readonly AtmMapLatLng[]): void => {
    for (const code of zoneGeometryIssues(points))
      issue(path, code, 'the shape is not a valid zone');
  };
  save.creates.forEach((c, i) => {
    geometry(`body.creates.${String(i)}.points`, c.points);
  });
  save.updates.forEach((u, i) => {
    if (u.points !== undefined) geometry(`body.updates.${String(i)}.points`, u.points);
  });

  if (details.length > 0) throw new ValidationError(details);
};

const liveZones = async (
  branchId: Types.ObjectId,
  session?: ClientSession,
): Promise<AtmMapZoneDoc[]> =>
  AtmMapZoneModel.find({ branchId, isDeleted: false })
    .sort({ order: 1, _id: 1 })
    .session(session ?? null)
    .lean<AtmMapZoneDoc[]>()
    .exec();

class AtmMapZoneService {
  /** PUT /zones — the whole session's changes of ONE branch, or nothing. */
  async save(input: SaveAtmMapZoneSet, ctx: AuthContext): Promise<AtmMapZoneSetDto> {
    // 1. Where.
    const resolved = await resolveZoneEditBranch(ctx);
    if (resolved.branchId === null) {
      if (resolved.blocked === 'chooseBranch') {
        throw new BusinessRuleError('choose one branch in the top bar before editing zones');
      }
      throw new ForbiddenError('the zone key does not reach this branch');
    }
    const branchIdText = resolved.branchId;
    if (input.branchId !== branchIdText) {
      throw new ValidationError([
        {
          field: 'body.branchId',
          code: 'BRANCH_MISMATCH',
          message: 'the zones belong to another branch than the one being edited — reload',
        },
      ]);
    }
    if (!keyReachesBranch(ctx, 'atmZone.manage', branchIdText)) {
      throw new ForbiddenError('the zone key does not reach this branch');
    }
    const branchId = new Types.ObjectId(branchIdText);
    const by = new Types.ObjectId(ctx.userId);

    // 2. Against the live zones.
    const live = await liveZones(branchId);
    validateSave(input, live);

    // 3. One transaction: the revision CAS, then the writes, then the set as committed.
    const { set, audits } = await unitOfWork(async (session) => {
      const pending: PendingAudit[] = [];
      if (input.revision === 0) {
        try {
          await AtmMapZoneSetModel.create(
            [{ branchId, revision: 1, createdBy: by, updatedBy: by }],
            { session },
          );
        } catch (error) {
          if (isDuplicateKey(error)) throw stale();
          throw error;
        }
      } else {
        const moved = await AtmMapZoneSetModel.findOneAndUpdate(
          { branchId, revision: input.revision, isDeleted: false },
          { $inc: { revision: 1, __v: 1 }, $set: { updatedBy: by } },
          { new: true, session },
        )
          .lean()
          .exec();
        if (moved === null) throw stale();
      }

      const before = new Map(live.map((z) => [String(z._id), z]));
      const finalIndex = new Map(input.order.map((id, i) => [id, i]));

      if (input.deletes.length > 0) {
        await AtmMapZoneModel.updateMany(
          {
            _id: { $in: input.deletes.map((id) => new Types.ObjectId(id)) },
            branchId,
            isDeleted: false,
          },
          {
            $set: { isDeleted: true, deletedAt: new Date(), deletedBy: by, updatedBy: by },
            $inc: { __v: 1 },
          },
          { session },
        ).exec();
      }

      // Each surviving zone is written once: its changed fields and, when it moved, its order.
      const updateOf = new Map(input.updates.map((u) => [u.id, u]));
      for (const zone of live) {
        const id = String(zone._id);
        if (input.deletes.includes(id)) continue;
        const update = updateOf.get(id);
        const order = finalIndex.get(id) ?? zone.order;
        const $set: Record<string, unknown> = {
          ...(update?.name === undefined ? {} : { name: update.name }),
          ...(update?.color === undefined ? {} : { color: update.color }),
          ...(update?.points === undefined ? {} : { points: update.points }),
          ...(order === zone.order ? {} : { order }),
        };
        if (Object.keys($set).length === 0) continue;
        await AtmMapZoneModel.updateOne(
          { _id: zone._id, branchId, isDeleted: false },
          { $set: { ...$set, updatedBy: by }, $inc: { __v: 1 } },
          { session },
        ).exec();
      }

      const createdIds = new Map<string, string>();
      if (input.creates.length > 0) {
        const inserted = await AtmMapZoneModel.insertMany(
          input.creates.map((c) => ({
            branchId,
            name: c.name,
            color: c.color,
            order: finalIndex.get(c.tempId) ?? 0,
            points: c.points,
            createdBy: by,
            updatedBy: by,
          })),
          { session },
        );
        input.creates.forEach((c, i) => {
          const doc = inserted[i];
          if (doc !== undefined) createdIds.set(c.tempId, String(doc._id));
        });
      }

      const after = await liveZones(branchId, session);
      const afterById = new Map(after.map((z) => [String(z._id), z]));
      for (const c of input.creates) {
        const id = createdIds.get(c.tempId);
        const zone = id === undefined ? undefined : afterById.get(id);
        if (id === undefined || zone === undefined) continue;
        pending.push({
          entityRef: zoneRef(id),
          action: 'create',
          changes: diffChanges({}, zoneSnapshot(zone)),
        });
      }
      for (const [id, old] of before) {
        const now = afterById.get(id);
        if (now === undefined) {
          pending.push({
            entityRef: zoneRef(id),
            action: 'delete',
            changes: diffChanges(zoneSnapshot(old), {}),
          });
          continue;
        }
        const changes = diffChanges(zoneSnapshot(old), zoneSnapshot(now));
        if (changes.length > 0) pending.push({ entityRef: zoneRef(id), action: 'update', changes });
      }

      const current = await AtmMapZoneSetModel.findOne({ branchId, isDeleted: false })
        .session(session)
        .lean()
        .exec();
      return {
        set: toZoneSetDto(branchIdText, current, after),
        audits: pending,
      };
    });

    // 4. After the commit.
    await recordAll(audits);
    return set;
  }
}

export const atmMapZoneService = new AtmMapZoneService();
