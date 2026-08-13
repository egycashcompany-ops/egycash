// HR side of the branch-code seam (HR3-A).
//
// THE DEFECT THIS CLOSES, and it was named in the design before it was found: the Employee Code is
// `<BranchCode><GlobalEmployeeNumber>` (ADR-017) — DERIVED, but STORED on the employee and
// denormalized onto the Employee File. A super-admin correcting a branch's code therefore left
// every employee in that branch carrying a code that no longer derived from anything.
//
// WHAT IS REPAIRED, AND WHY EXACTLY THIS SET. Not a judgement call: it is the same propagation a
// TRANSFER already performs when it moves someone between branches — `employee.code`, then the
// Employee File's denormalized copy — and nothing else. Both changes have the same shape (the
// branch prefix moves), so they must have the same reach, or the two paths would disagree about
// what an employee code is.
//
// WHAT IS DELIBERATELY LEFT ALONE. Every record that was ISSUED with a code keeps it: a contract,
// a hiring document, a payslip (PY-7 stores the identity as it stood at issue), a leave request,
// and every personnel action — that last one especially, because the action log IS the history of
// what the code was. Rewriting any of them would restate a document somebody was handed.
//
// AND THIS IS NOT A PERSONNEL ACTION. Nobody was promoted, moved or re-hired; an administrator
// corrected a branch's code, and the branch's own audit entry records that. The action vocabulary
// is closed and stays closed.
import { Types } from 'mongoose';
import { registerBranchCodeChangeHandler } from '../../../../platform/organization';
import { logger } from '../../../../infrastructure/logging/logger';
import { employeeFileService } from '../employee-file';
import { EmployeeModel } from './employee.model';
import { buildEmployeeCode } from './employee-number';

/**
 * Re-derive the stored code of every employee in the branch.
 *
 * No uniqueness risk, and it is worth saying why: a code is the branch prefix plus the GLOBAL
 * employee number, which is unique across the whole company — so two employees cannot collide
 * whatever prefix they carry, and the branch's own code was already proven unique by the write
 * that got us here.
 */
export const registerHrBranchCodeSeams = (): void => {
  registerBranchCodeChangeHandler(async ({ branchId, newCode, by }) => {
    const employees = await EmployeeModel.find({
      branchId: new Types.ObjectId(branchId),
      isDeleted: false,
    })
      .select({ _id: 1, code: 1, employeeNumber: 1 })
      .lean<{ _id: Types.ObjectId; code: string; employeeNumber: string }[]>()
      .exec();

    let repaired = 0;
    for (const employee of employees) {
      const derived = buildEmployeeCode(newCode, employee.employeeNumber);
      if (derived === employee.code) continue;

      await EmployeeModel.updateOne(
        { _id: employee._id },
        { $set: { code: derived, updatedBy: new Types.ObjectId(by) } },
      ).exec();
      // The same file sync a transfer performs — the branch itself has not moved, so the file's
      // `branchId` is already right and only the denormalized code needs to follow.
      await employeeFileService.syncEmployeeIdentity(String(employee._id), derived, branchId);
      repaired += 1;
    }

    if (repaired > 0) {
      logger.info({ branchId, newCode, repaired }, 'employee codes re-derived after a branch-code change');
    }
    return repaired;
  });
};
