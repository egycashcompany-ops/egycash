// Job Requisition reference seam (Sprint 4.1 plan §1.2, BD-001, OQ-30). The Requisition
// (Stage 0) is a separately-planned capability that does NOT exist yet, so *validating that a
// requisition exists and is approved* is deferred behind this interface. The default performs
// structural validation only; when Stage 0 lands, a real validator (existence + approved +
// branch resolution) replaces it with no change to the applicant service.
//
// The reference itself is OPTIONAL, not mandatory: Sprint 4.1 specified that every applicant
// belongs to exactly one approved requisition, and ADR-016 overturned that — an applicant may
// walk in with no vacancy behind them (the Talent Pool). `jobRequisitionId` is nullable on the
// model and optional in the contract, and `applicant.service.ts` calls the validator only when a
// value was supplied. A validator that arrives later must keep that shape: it answers questions
// about a reference somebody made, never demands that one exists.
import { Types } from 'mongoose';

export interface RequisitionRef {
  jobRequisitionId: string;
  branchId?: string | null;
}

export interface RequisitionResolution {
  ok: boolean;
  /** Branch the requisition belongs to, when the validator can resolve it (else null). */
  branchId: string | null;
  error?: string;
}

export interface RequisitionReferenceValidator {
  id: string;
  resolve(ref: RequisitionRef): Promise<RequisitionResolution>;
}

/**
 * Structural-only default (Stage 0 not built): accepts any well-formed ObjectId and echoes
 * the caller-supplied branch. Existence/approval/headcount checks arrive with the
 * Requisition module and its own validator implementation.
 */
export const permissiveRequisitionValidator: RequisitionReferenceValidator = {
  id: 'permissive',
  resolve: (ref) =>
    Promise.resolve({
      ok: Types.ObjectId.isValid(ref.jobRequisitionId),
      branchId: ref.branchId ?? null,
      ...(Types.ObjectId.isValid(ref.jobRequisitionId)
        ? {}
        : { error: 'malformed jobRequisitionId' }),
    }),
};

let validator: RequisitionReferenceValidator = permissiveRequisitionValidator;

export const setRequisitionValidator = (next: RequisitionReferenceValidator): void => {
  validator = next;
};

export const getRequisitionValidator = (): RequisitionReferenceValidator => validator;

export const resetRequisitionValidator = (): void => {
  validator = permissiveRequisitionValidator;
};
