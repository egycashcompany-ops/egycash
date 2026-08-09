// Priorities — the help desk's SLA policy (design §2.6). Reference data: audited, no events.
//
// Editing a priority changes what FUTURE tickets promise. It never touches a ticket already open:
// each one snapshotted its targets at creation, which is the whole reason the snapshot exists.
import {
  type CreateItTicketPriority,
  type ListItTicketPrioritiesQuery,
  type Paginated,
  type UpdateItTicketPriority,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { itTicketPriorityRepository } from './priority.repository';
import { type ItTicketPriorityDoc } from './priority.model';

const entityRef = (id: string) => ({ moduleId: 'it', entityType: 'ticketPriority', entityId: id });

const snapshot = (doc: ItTicketPriorityDoc) => ({
  name: doc.name,
  rank: doc.rank,
  responseMinutes: doc.responseMinutes,
  resolutionMinutes: doc.resolutionMinutes,
  isActive: doc.isActive,
});

class ItTicketPriorityService {
  async create(input: CreateItTicketPriority, by: string): Promise<ItTicketPriorityDoc> {
    const clash = await itTicketPriorityRepository.findOne({ rank: input.rank, isActive: true });
    if (clash !== null) {
      throw new ConflictError(`an active priority already occupies rank ${input.rank}`);
    }
    const doc = await itTicketPriorityRepository.create(
      {
        name: input.name,
        rank: input.rank,
        responseMinutes: input.responseMinutes,
        resolutionMinutes: input.resolutionMinutes,
        isActive: true,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  async list(query: ListItTicketPrioritiesQuery): Promise<Paginated<ItTicketPriorityDoc>> {
    return itTicketPriorityRepository.listFiltered({
      isActive: query.isActive,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }

  async update(
    id: string,
    input: UpdateItTicketPriority,
    by: string,
  ): Promise<ItTicketPriorityDoc> {
    const before = await itTicketPriorityRepository.getById(id);
    const response = input.responseMinutes ?? before.responseMinutes;
    const resolution = input.resolutionMinutes ?? before.resolutionMinutes;
    // Checked against the MERGED values: editing one target alone must not be able to invert the
    // pair, which a field-local schema rule cannot see.
    if (resolution < response) {
      throw new BusinessRuleError('the resolution target cannot be shorter than the response target');
    }
    if (input.rank !== undefined && input.rank !== before.rank) {
      const clash = await itTicketPriorityRepository.findOne({ rank: input.rank, isActive: true });
      if (clash !== null && String(clash._id) !== id) {
        throw new ConflictError(`an active priority already occupies rank ${input.rank}`);
      }
    }
    const set: Partial<ItTicketPriorityDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.rank !== undefined) set.rank = input.rank;
    if (input.responseMinutes !== undefined) set.responseMinutes = input.responseMinutes;
    if (input.resolutionMinutes !== undefined) set.resolutionMinutes = input.resolutionMinutes;
    if (input.isActive !== undefined) set.isActive = input.isActive;

    const updated = await itTicketPriorityRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const itTicketPriorityService = new ItTicketPriorityService();
