// Recording what happened, and never changing it (P-HR-MED D7, D8, D9, D11, D13, D14).
//
// THERE IS ONE WRITE AND IT IS `record`. No update, no correction, no «fix the provider's name» —
// the repository refuses those at the seam, so this service has nothing to offer that would work.
// A correction is a new event, which is the only account of history that survives somebody asking
// «what did we know, and when».
//
// THE VERDICT IS AN ARGUMENT (D7). It arrives from whoever examined the person and is written down.
// Nothing here computes it, nothing recomputes it when a condition is added to the profile, and
// nothing acts on it (D11): an unfit verdict suspends nobody, because that is a decision with legal
// weight that a person makes and records as a personnel action.
import { type Types } from 'mongoose';
import {
  HrMedicalEvents,
  type ListMedicalEventsQuery,
  type Paginated,
  type RecordMedicalEvent,
} from '@ecms/contracts';
import { NotFoundError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { fileService, type UploadedBinary } from '../../../../platform/files';
import { employeeRepository } from '../../employee-management/employees/employee.repository';
import { medicalEventRepository } from '../medical.repository';
import { MEDICAL_EVENT_ENTITY_TYPE, resolveMedicalDocumentCategoryId } from './medical-event.files';
import { type MedicalEventDoc } from './medical-event.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'medicalEvent', entityId: id });

class MedicalEventService {
  async list(
    query: ListMedicalEventsQuery,
    scope: ScopeSelector,
    ctx: AuthContext,
  ): Promise<Paginated<MedicalEventDoc>> {
    const type =
      query.type === undefined ? undefined : Array.isArray(query.type) ? query.type : [query.type];
    const page = await medicalEventRepository.listFiltered(
      { employeeId: query.employeeId, type, from: query.from, to: query.to },
      { page: query.page, pageSize: query.pageSize, sortBy: query.sortBy, sortDir: query.sortDir },
      scope,
    );
    // D14 — reading somebody's medical history is a read of their clinical record, and the list is
    // where most of that reading actually happens. Auditing only the single-record read would leave
    // the common path untraced.
    if (query.employeeId !== undefined) {
      await auditService.record({
        entityRef: { moduleId: 'hr', entityType: 'medicalProfile', entityId: query.employeeId },
        action: 'medicalRecordRead',
        actor: { userId: ctx.userId, ip: null, userAgent: null },
      });
    }
    return page;
  }

  /**
   * Record an event, with its certificate if there is one.
   *
   * THE DOCUMENT IS UPLOADED AFTER THE ROW AND LINKED FROM THE FILE'S SIDE. The event can never be
   * written again (D9), so it cannot hold a file id assigned after the upload — the file carries
   * the link instead, filed against `hr.medicalEvent` and this event's id, which is the direction
   * the file service already indexes.
   *
   * The employee's name and code are SNAPSHOTTED, unlike the profile's cache: this row says who was
   * examined, as they were named then. A rename in 2029 must not restate what a 2026 certificate
   * was about.
   */
  async record(
    ctx: AuthContext,
    input: RecordMedicalEvent,
    binary: UploadedBinary | null,
  ): Promise<MedicalEventDoc> {
    const employee = await employeeRepository.findById(input.employeeId);
    if (employee === null) throw new NotFoundError('no such employee');

    const doc = await medicalEventRepository.create(
      {
        employeeId: employee._id,
        employeeCode: employee.code,
        employeeName: employee.personal.fullNameAr,
        type: input.type,
        occurredOn: input.occurredOn,
        provider: input.provider ?? null,
        verdict: input.verdict ?? null,
        restriction: input.restriction ?? null,
        validUntil: input.validUntil ?? null,
        note: input.note ?? null,
      },
      { by: ctx.userId },
    );

    if (binary !== null) {
      const categoryId = await resolveMedicalDocumentCategoryId();
      await fileService.upload(
        ctx,
        {
          moduleId: 'hr',
          entityType: MEDICAL_EVENT_ENTITY_TYPE,
          entityId: String(doc._id),
          categoryId,
          // The employee's code rather than their name: a file's display name travels further than
          // the record it belongs to, and a filename is not a place to put somebody's health data.
          displayName: `${employee.code} — ${input.type}`,
          visibility: 'private',
          tags: [],
        },
        binary,
      );
    }

    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      // NO `changes`. A diff of a medical event would copy the verdict and the restriction into the
      // audit log, whose whole purpose is to be widely readable by administrators — the same
      // reasoning that keeps the clinical content out of the READ rows (D3, D14).
    });
    await emit(HrMedicalEvents.Recorded, {
      eventId: String(doc._id),
      employeeId: String(employee._id),
    });
    return doc;
  }

  /**
   * The event's document, read back by entity.
   *
   * Returns the newest, because the file service keeps versions and an event has at most one
   * certificate — a second upload against the same event is a rescan of the same paper.
   */
  async documentOf(
    ctx: AuthContext,
    eventId: string,
    scope: ScopeSelector,
  ): Promise<{ id: string; name: string } | null> {
    const page = await fileService.list(
      { entityId: eventId, page: 1, pageSize: 1, sortBy: 'createdAt', sortDir: 'desc' },
      scope,
      ctx,
    );
    const file = page.items[0];
    return file === undefined
      ? null
      : { id: String(file._id as Types.ObjectId), name: file.originalName };
  }
}

export const medicalEventService = new MedicalEventService();
