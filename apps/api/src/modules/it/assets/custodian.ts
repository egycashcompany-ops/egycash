// The DEPARTMENT a hand-over, a receipt or a transfer names — «في عهدة إدارة … — الموقع …»
// (2026-11-19) — read once, BEFORE the custody transaction, like the employee's `readReceiptHolder`:
// another module's data has no business holding a custody write open.
//
// Three reads and their refusals, in the order the design gives them:
//   1. the RESPONSIBLE PERSON who signs for the department — HR's answer, through the receipt
//      holder seam (their name, code, job and identity line print on the paper); a leaver is
//      refused, on a positive answer only, as a leaver is refused custody of their own;
//   2. the DEPARTMENT — any ACTIVE platform department, in any branch: head-office IT may hold a
//      branch's server;
//   3. the PLACE («المواقع») — an active one. Which branch it must be in is the caller's rule (the
//      asset's, for a hand-over; the branch it goes to, for a transfer), judged on what this returns.
//
// The refusals are 422 field issues on the request's own key (`body.department.locationId`,
// `body.toDepartment.departmentId` …) — the contract sees ids only, so whether an id names a live
// row is the server's to say.
import { ErrorCodes, type ItCustodianDepartmentInput } from '@ecms/contracts';
import { Types } from 'mongoose';
import { AppError, BusinessRuleError } from '../../../shared/errors';
import { departmentRepository } from '../../../platform/organization';
import { itLocationRepository } from '../locations/location.repository';
import { readReceiptHolder, type ReceiptHolder } from './receipt-holder';
import { departmentHolderOf, type DepartmentHolder } from './custody-holder';

type Name = { ar: string; en: string };

/** The request key the department came in under — a hand-over's, or a transfer's. */
export type CustodianField = 'body.department' | 'body.toDepartment';

/** A department custodian as read for one custody act. */
export interface CustodianRead {
  holder: DepartmentHolder;
  /** The responsible person, as HR answers for them — the paper's signer. */
  signer: ReceiptHolder;
  departmentName: Name;
  locationName: Name;
  /** The branch the place is in — every asset kept there must be in it. */
  locationBranchId: string;
}

/** The paper's snapshot of the department and the place (receipt.model.ts `custodian`). */
export interface CustodianSnapshot {
  departmentId: Types.ObjectId;
  departmentName: Name | null;
  locationId: Types.ObjectId;
  locationName: Name | null;
}

/** 422 on one field of the request — UNKNOWN, INACTIVE or OTHER_BRANCH. */
export const custodianRefusal = (field: string, code: string, message: string): AppError =>
  new AppError(ErrorCodes.BUSINESS_RULE_VIOLATION, 422, message, {
    details: [{ field, code, message }],
  });

const nameOf = (name: Name): Name => ({ ar: name.ar, en: name.en });

/**
 * The responsible person may sign only while they work here — the hand-over's own leaver rule,
 * said for the department: the person a paper binds must be somebody the company can hold to it.
 */
export const refuseLeavingSigner = (signer: ReceiptHolder): void => {
  if (signer.employee?.status === 'exited') {
    throw new BusinessRuleError(
      `employee ${signer.employee.code} has left the company; a department's custody can only be signed for by a current employee`,
    );
  }
};

export const readCustodian = async (
  input: ItCustodianDepartmentInput,
  field: CustodianField = 'body.department',
): Promise<CustodianRead> => {
  const holder = departmentHolderOf(input);
  const [signer, [department], [location]] = await Promise.all([
    readReceiptHolder(holder.responsibleEmployeeId),
    departmentRepository.findByIdsSystem([holder.departmentId]),
    itLocationRepository.findByIdsSystem([holder.locationId]),
  ]);
  refuseLeavingSigner(signer);
  if (department === undefined || department.isDeleted) {
    throw custodianRefusal(`${field}.departmentId`, 'UNKNOWN', 'department not found');
  }
  if (department.status !== 'active') {
    throw custodianRefusal(
      `${field}.departmentId`,
      'INACTIVE',
      'the department is inactive; custody is handed to an active department',
    );
  }
  if (location === undefined || location.isDeleted) {
    throw custodianRefusal(`${field}.locationId`, 'UNKNOWN', 'place not found');
  }
  if (!location.isActive) {
    throw custodianRefusal(
      `${field}.locationId`,
      'INACTIVE',
      'the place is retired; custody is kept at an active place',
    );
  }
  return {
    holder,
    signer,
    departmentName: nameOf(department.name),
    locationName: nameOf(location.name),
    locationBranchId: String(location.branchId),
  };
};

/**
 * A department hand-over names ONE place, so its paper lists one branch's assets: every asset must
 * be in the place's branch — refused naming every asset that is not.
 */
export const refuseOutsidePlaceBranch = (
  custodian: CustodianRead,
  assets: readonly { assetCode: string; branchId: Types.ObjectId | string }[],
  field: CustodianField = 'body.department',
): void => {
  const outside = assets
    .filter((asset) => String(asset.branchId) !== custodian.locationBranchId)
    .map((asset) => asset.assetCode);
  if (outside.length === 0) return;
  throw custodianRefusal(
    `${field}.locationId`,
    'OTHER_BRANCH',
    `a department hand-over names one place; every asset must be in that place's branch — ${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} not`,
  );
};

/** The department and place as the paper keeps them. */
export const custodianSnapshot = (custodian: CustodianRead): CustodianSnapshot => ({
  departmentId: new Types.ObjectId(custodian.holder.departmentId),
  departmentName: custodian.departmentName,
  locationId: new Types.ObjectId(custodian.holder.locationId),
  locationName: custodian.locationName,
});
