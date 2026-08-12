// The second door in the Payroll→Attendance wall (PY-6), and the only one that WRITES.
//
// PY-4 opened a read door for pricing; this one calls the freeze. Both stay narrow for the same
// reason — the attendance barrel exports the day model itself, so one convenient import would let
// payroll read a month whose truth was still moving.
//
// This file is the ONLY place `freezePeriod()` may be called from, in this module or any other:
// no route mounts it, no schedule fires it, and the attendance design names the payroll run as its
// caller. Freezing is irreversible, so it stays a deliberate act with exactly one caller.
import { dayRecordService } from '../../attendance';

export interface AttendanceFreezePort {
  freeze(period: string): Promise<{ computed: number; frozen: number; alreadyFrozen: boolean }>;
}

export const attendanceFreezePort: AttendanceFreezePort = {
  async freeze(period) {
    const { computed, frozen, alreadyFrozen } = await dayRecordService.freezePeriod(period);
    return { computed, frozen, alreadyFrozen };
  },
};
