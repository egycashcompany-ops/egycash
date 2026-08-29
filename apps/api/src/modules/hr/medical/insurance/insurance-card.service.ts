// The card: issuing it, correcting it, ending it (P-HR-MED D2, D10, D13).
//
// THREE WRITES AND NO FOURTH. There is no renewal endpoint, because a renewal is what the provider
// does — ending one card and issuing another — and modelling it as a single act would hide which
// number somebody actually held on a given day. `renewed` is an EVENT the service emits when an
// issue follows an end for the same person, not an operation of its own.
//
// NOTHING CONCLUDES FROM A DATE (D13). A card whose `endsOn` has passed keeps saying `active` until
// somebody ends it. That looks like a bug until you ask what the alternative would do: a sweep that
// closed cards on a date would be the system deciding somebody is uninsured, which is a claim the
// company makes to a clinic and not one a cron job should make.
import { Types } from 'mongoose';
import {
  HrMedicalInsuranceEvents,
  type EndInsuranceCard,
  type IssueInsuranceCard,
  type ListInsuranceCardsQuery,
  type Paginated,
  type UpdateInsuranceCard,
} from '@ecms/contracts';
import { BusinessRuleError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { diffChanges } from '../../../../shared/utils/diff';
import { employeeRepository } from '../../employee-management/employees/employee.repository';
import { insuranceCardRepository } from '../medical.repository';
import { type InsuranceCardDoc } from './insurance-card.model';

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'medicalInsurance',
  entityId: id,
});

const snapshot = (doc: InsuranceCardDoc) => ({
  provider: doc.provider,
  cardNumber: doc.cardNumber,
  tier: doc.tier,
  status: doc.status,
  startsOn: doc.startsOn.toISOString(),
  endsOn: doc.endsOn === null ? null : doc.endsOn.toISOString(),
  dependants: doc.dependants.map((d) => `${d.name} (${d.relationship})`).join(' | '),
  note: doc.note,
});

class InsuranceCardService {
  async list(
    query: ListInsuranceCardsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<InsuranceCardDoc>> {
    return insuranceCardRepository.listFiltered(
      {
        employeeId: query.employeeId,
        status: query.status,
        provider: query.provider,
        search: query.search,
      },
      { page: query.page, pageSize: query.pageSize, sortBy: query.sortBy, sortDir: query.sortDir },
      scope,
    );
  }

  /**
   * Issue a card.
   *
   * ONE LIVE CARD PER PERSON, refused in the service as well as by the index: the index protects
   * the data and the service explains the refusal. «Duplicate key» tells an HR officer nothing;
   * «this person already holds an active card — end it first» tells them what to do, and is also
   * what the provider would have said.
   *
   * BOTH AXES ARE STAMPED FROM THE EMPLOYEE, unlike the clinical rows which carry none (D4). A card
   * is administered by branch; a condition is not.
   */
  async issue(ctx: AuthContext, input: IssueInsuranceCard): Promise<InsuranceCardDoc> {
    const employee = await employeeRepository.findById(input.employeeId);
    if (employee === null) throw new NotFoundError('no such employee');

    const live = await insuranceCardRepository.findActive(input.employeeId);
    if (live !== null) {
      throw new BusinessRuleError(
        'this person already holds an active card — end it before issuing another',
      );
    }
    // A card issued after a previous one ended is a RENEWAL, and the event says so. The row does
    // not: «renewed» is a fact about the sequence, not a state a card is in.
    const hadPrevious = await insuranceCardRepository.count({
      employeeId: new Types.ObjectId(input.employeeId),
    });

    const doc = await insuranceCardRepository.create(
      {
        employeeId: employee._id,
        employeeCode: employee.code,
        employeeName: employee.personal.fullNameAr,
        provider: input.provider,
        cardNumber: input.cardNumber,
        tier: input.tier ?? null,
        status: 'active',
        startsOn: input.startsOn,
        endsOn: input.endsOn ?? null,
        endedOn: null,
        endReason: null,
        dependants: input.dependants ?? [],
        note: input.note ?? null,
        branchId: employee.branchId,
        departmentId: employee.departmentId,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(
      hadPrevious > 0 ? HrMedicalInsuranceEvents.Renewed : HrMedicalInsuranceEvents.Issued,
      { cardId: String(doc._id), employeeId: String(employee._id), provider: doc.provider },
    );
    return doc;
  }

  /** Correcting a live card — a typo, a dependant added, a tier changed. Refused once ended. */
  async update(
    ctx: AuthContext,
    id: string,
    input: UpdateInsuranceCard,
    scope: ScopeSelector,
  ): Promise<InsuranceCardDoc> {
    const before = await insuranceCardRepository.getById(id, scope);
    if (before.status !== 'active') {
      throw new BusinessRuleError('an ended card is a record of what somebody held, not a draft');
    }
    const set: Partial<InsuranceCardDoc> = {};
    if (input.provider !== undefined) set.provider = input.provider;
    if (input.cardNumber !== undefined) set.cardNumber = input.cardNumber;
    if (input.tier !== undefined) set.tier = input.tier;
    if (input.endsOn !== undefined) set.endsOn = input.endsOn;
    if (input.dependants !== undefined) set.dependants = input.dependants;
    if (input.note !== undefined) set.note = input.note;

    const updated = await insuranceCardRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }

  /**
   * End cover — a PERSON saying it ended (D13).
   *
   * `endedOn` comes from the caller rather than the clock, because a card is usually ended after
   * the fact: somebody notices the policy lapsed, or that an employee left in March. Stamping the
   * day of the paperwork would misdate every one of them.
   */
  async end(
    ctx: AuthContext,
    id: string,
    input: EndInsuranceCard,
    scope: ScopeSelector,
  ): Promise<InsuranceCardDoc> {
    const before = await insuranceCardRepository.getById(id, scope);
    if (before.status !== 'active') {
      throw new BusinessRuleError('this card has already ended');
    }
    const updated = await insuranceCardRepository.updateById(
      id,
      {
        status: 'ended',
        endedOn: input.endedOn,
        endReason: input.reason ?? null,
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(HrMedicalInsuranceEvents.Ended, {
      cardId: id,
      employeeId: String(updated.employeeId),
      provider: updated.provider,
    });
    return updated;
  }
}

export const insuranceCardService = new InsuranceCardService();
