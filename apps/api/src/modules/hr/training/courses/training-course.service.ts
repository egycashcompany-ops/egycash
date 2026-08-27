// The training catalogue, administered (P-HR-TRN D1).
//
// DEACTIVATION, NEVER DELETION, and the reason is D8 rather than tidiness: the immutable records
// name this course, and a catalogue row that could disappear would leave a certificate describing
// something the system can no longer explain. `delete` is not offered; `active: false` is.
import {
  type CreateTrainingCourse,
  type ListTrainingCoursesQuery,
  type Paginated,
  type UpdateTrainingCourse,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../../shared/errors';
import { auditService } from '../../../../platform/audit';
import { diffChanges } from '../../../../shared/utils/diff';
import { trainingSessionRepository } from '../sessions/training-session.repository';
import { trainingCourseRepository } from './training-course.repository';
import { type TrainingCourseDoc } from './training-course.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'trainingCourse', entityId: id });

const snapshot = (doc: TrainingCourseDoc) => ({
  name: doc.name,
  description: doc.description,
  defaultDurationHours: doc.defaultDurationHours,
  defaultDeliveryMode: doc.defaultDeliveryMode,
  order: doc.order,
  active: doc.active,
});

class TrainingCourseService {
  async list(query: ListTrainingCoursesQuery): Promise<Paginated<TrainingCourseDoc>> {
    return trainingCourseRepository.listFiltered(query);
  }

  async getById(id: string): Promise<TrainingCourseDoc> {
    return trainingCourseRepository.getById(id);
  }

  async create(input: CreateTrainingCourse, by: string): Promise<TrainingCourseDoc> {
    const existing = await trainingCourseRepository.findByKey(input.key);
    if (existing !== null) throw new ConflictError(`Training course "${input.key}" already exists`);
    const doc = await trainingCourseRepository.create(
      {
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        defaultDurationHours: input.defaultDurationHours ?? null,
        defaultDeliveryMode: input.defaultDeliveryMode,
        order: input.order,
        active: true,
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

  /**
   * Idempotent create-if-missing for the boot seed.
   *
   * Create-if-MISSING and not upsert: the seed states a starting catalogue, and an administrator
   * who renamed a course or retired one has made a decision the next boot must not undo. The key
   * is the identity, and finding it is the whole check.
   */
  async ensure(input: CreateTrainingCourse): Promise<TrainingCourseDoc> {
    const existing = await trainingCourseRepository.findByKey(input.key);
    if (existing !== null) return existing;
    return trainingCourseRepository.create(
      {
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        defaultDurationHours: input.defaultDurationHours ?? null,
        defaultDeliveryMode: input.defaultDeliveryMode,
        order: input.order,
        active: true,
      },
      { by: null },
    );
  }

  async update(id: string, input: UpdateTrainingCourse, by: string): Promise<TrainingCourseDoc> {
    const before = await trainingCourseRepository.getById(id);
    /**
     * DEACTIVATING A COURSE WITH LIVE DELIVERIES IS REFUSED. A scheduled session whose course has
     * been retired is a room booked to teach something the catalogue says we no longer teach —
     * and the people nominated for it were told otherwise. Cancel the sessions, then retire the
     * course. Completed sessions do not count: those are history, and history is the point of D8.
     */
    if (input.active === false && before.active) {
      const live = await trainingSessionRepository.countLiveForCourse(id);
      if (live > 0) {
        throw new BusinessRuleError(
          `this course has ${String(live)} scheduled or running session(s) — cancel them first`,
        );
      }
    }
    const set: Partial<TrainingCourseDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;
    if (input.defaultDurationHours !== undefined) {
      set.defaultDurationHours = input.defaultDurationHours;
    }
    if (input.defaultDeliveryMode !== undefined) set.defaultDeliveryMode = input.defaultDeliveryMode;
    if (input.order !== undefined) set.order = input.order;
    if (input.active !== undefined) set.active = input.active;

    const updated = await trainingCourseRepository.updateById(id, set, {
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

export const trainingCourseService = new TrainingCourseService();
