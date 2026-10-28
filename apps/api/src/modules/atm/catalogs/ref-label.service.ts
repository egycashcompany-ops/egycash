// Add / remove for the two label lists — the checkment2/3 (add) and checkment8/9 (remove)
// branches of the legacy /data_edit_atm POST (contad_app.js:2471-2527). Configuration, not
// domain facts: audited, no events (the operations bank precedent).
//
// Add and edit are Operations' own keys (`atmRefLabel.create` / `.edit`) beside `atmMachine.manage`
// (D2); remove stays `manage`. A label is filed in ONE branch, and a bank label there drives what
// the register adopts (D5, DEC-16 — `NBE FOREX`), so the authorizing key must reach THAT branch
// (DEC-29, review finding F-4): the caller's acting branch alone is chosen from the union reach of
// all their grants, which an unrelated key could stretch to a branch this key never covers.
import { Types, type FilterQuery } from 'mongoose';
import {
  type CreateAtmRefLabel,
  type ListAtmRefLabelsQuery,
  type Paginated,
  type UpdateAtmRefLabel,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import {
  hasPermission,
  keyReachesBranch,
  reachOfKey,
  scopeSelector,
  type AuthContext,
} from '../../../shared/types';
import { ForbiddenError, NotFoundError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { BaseRepository } from '../../../shared/base/base.repository';
import { resolveAtmBranchId } from '../shared/atm-context';
import { AtmRefLabelModel, type AtmRefLabelDoc, type AtmRefLabelKind } from './ref-label.model';

class AtmRefLabelRepository extends BaseRepository<AtmRefLabelDoc> {
  constructor() {
    super(AtmRefLabelModel, { branchField: 'branchId' });
  }
}

export const atmRefLabelRepository = new AtmRefLabelRepository();

const entityRef = (id: string) => ({ moduleId: 'atm', entityType: 'refLabel', entityId: id });

class AtmRefLabelService {
  async list(
    kind: AtmRefLabelKind,
    query: ListAtmRefLabelsQuery,
    ctx: AuthContext,
  ): Promise<Paginated<AtmRefLabelDoc>> {
    const filter: FilterQuery<AtmRefLabelDoc> = { kind };
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    return atmRefLabelRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['name', 'createdAt'],
      scope: scopeSelector(ctx, 'atmMachine.view'),
    });
  }

  async create(
    kind: AtmRefLabelKind,
    input: CreateAtmRefLabel,
    ctx: AuthContext,
  ): Promise<AtmRefLabelDoc> {
    const branchId = await resolveAtmBranchId(ctx);
    // A `manage` holder whose grant reaches no whole branch (department, section or own scope)
    // keeps today's add in the branch they are PLACED in — before this feature they could add
    // there, and the placement is the one branch no other key can stretch (review finding F1).
    // Only for those scopes, and only when the grant lists no units elsewhere: a `branch` grant
    // (a delegated deputy's, say) answers through keyReachesBranch alone, so a deputy reaching
    // Alexandria cannot file a label into the Tanta branch they happen to be placed in.
    const manageScope = ctx.permissions['atmMachine.manage'];
    const manageReach = reachOfKey(ctx, 'atmMachine.manage');
    const manageAtHome =
      (manageScope === 'department' || manageScope === 'section' || manageScope === 'own') &&
      manageReach.branchIds.length === 0 &&
      manageReach.departments.length === 0 &&
      ctx.branchId !== null &&
      branchId === ctx.branchId;
    if (
      !keyReachesBranch(ctx, 'atmRefLabel.create', branchId) &&
      !keyReachesBranch(ctx, 'atmMachine.manage', branchId) &&
      !manageAtHome
    ) {
      throw new ForbiddenError();
    }
    // The unique index turns the legacy's read-then-push duplicate check (:2473, :2485) into a
    // ConflictError the client renders as "already exists" — same rule, no race.
    // The schema guarantees `name` or both display names; a dialog's pair stores the ENGLISH one
    // (the owner: «الإنجليزي تمام» — stored areas are Latin, and the import's ` FX` rule needs it).
    const name = (input.name ?? input.nameEn ?? '').trim();
    const doc = await atmRefLabelRepository.create(
      { branchId: new Types.ObjectId(branchId), kind, name, isActive: true },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, { kind, name: doc.name, branchId }),
    });
    return doc;
  }

  /**
   * Edit a label. Renaming changes what the forms OFFER from here on; it does not rewrite the
   * machines that already stored the old string, because the legacy denormalized both the bank
   * and the area onto each machine (:2443) and a cascade would rewrite history nobody asked to
   * change. `isActive: false` archives — the list stops offering it, the machines keep it.
   *
   * Allowed to an `atmRefLabel.edit` holder over the label's whole branch, or to a `manage`
   * holder who finds the label in today's `manage` scope (nothing removed); anything else is a
   * 404. The label repository is branch-only, so a department or section scope alone would widen
   * to the company — reach is asked of the key. The write then goes by id and version.
   */
  async update(id: string, input: UpdateAtmRefLabel, ctx: AuthContext): Promise<AtmRefLabelDoc> {
    const before = await atmRefLabelRepository.findById(id);
    if (before === null) throw new NotFoundError('ATM label');
    const allowed =
      keyReachesBranch(ctx, 'atmRefLabel.edit', String(before.branchId)) ||
      (hasPermission(ctx, 'atmMachine.manage') &&
        (await atmRefLabelRepository.findById(id, scopeSelector(ctx, 'atmMachine.manage'))) !==
          null);
    if (!allowed) throw new NotFoundError('ATM label');
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name.trim();
    if (input.isActive !== undefined) set.isActive = input.isActive;
    const updated = await atmRefLabelRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(
        { name: before.name, isActive: before.isActive },
        { name: updated.name, isActive: updated.isActive },
      ),
    });
    return updated;
  }

  /** Legacy `$pull` (:2514, :2523) — the name leaves the list; machines keep their strings. */
  async remove(id: string, ctx: AuthContext): Promise<void> {
    const doc = await atmRefLabelRepository.softDeleteById(id, {
      by: ctx.userId,
      scope: scopeSelector(ctx, 'atmMachine.manage'),
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: diffChanges({ kind: doc.kind, name: doc.name }, {}),
    });
  }
}

export const atmRefLabelService = new AtmRefLabelService();
