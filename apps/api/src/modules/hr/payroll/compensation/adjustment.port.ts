// The ONE place a calculation reads approved bonuses and penalties (P-HR-04).
//
// The third source the engine takes, after the pay-item assignment and the leave snapshot, and the
// port exists for the same reason both of those do: the engine stays pure, and there is exactly
// one door to walk through when you want to know what changed.
//
// WHAT THE FILTER IS DOING. `approved` only. A draft is a proposal and a rejected entry went back
// to draft — neither is a figure anybody has agreed to pay, and the difference between "recorded"
// and "approved" is the whole of D1. Putting the filter HERE rather than in the engine means the
// engine cannot be handed an unapproved figure by a future caller who forgot.
import { payrollAdjustmentRepository } from '../adjustments/payroll-adjustment.repository';
import { payItemRepository } from '../pay-items/pay-item.repository';
import { type AdjustmentInput } from './compensation-rules';

export interface AdjustmentPort {
  /** One employee's APPROVED adjustments for a period — an empty list when there are none. */
  approvedFor(employeeId: string, period: string): Promise<AdjustmentInput[]>;
}

export const adjustmentPort: AdjustmentPort = {
  async approvedFor(employeeId, period) {
    const docs = await payrollAdjustmentRepository.approvedFor(employeeId, period);
    // D4 — the catalog row lends the line its name when one was chosen. Resolved here rather than
    // in the engine, which must stay free of I/O; an item that has since been deleted simply falls
    // back to the fixed code, because a missing label is not a reason to withhold a payment.
    const items = new Map<string, { code: string; name: { ar: string; en: string } }>();
    for (const id of [...new Set(docs.map((d) => d.payItemId).filter((i) => i !== null))].map(
      String,
    )) {
      const item = await payItemRepository.findById(id);
      if (item !== null) items.set(id, { code: item.code, name: item.name });
    }

    return docs.map((doc) => ({
      id: String(doc._id),
      kind: doc.kind,
      amount: doc.amount,
      currency: doc.currency,
      reason: doc.reason,
      payItemId: doc.payItemId === null ? null : String(doc.payItemId),
      payItem: doc.payItemId === null ? null : (items.get(String(doc.payItemId)) ?? null),
    }));
  },
};
