// While «نقل البيانات» runs, the writes that make or change what it re-files wait for it (review
// finding). The move plans each step from what it reads, then writes in batches; a register
// receipt, link or import, a machine save or a label save landing in between could file a new
// master under the source (a coupling that no longer finds the master the move just re-filed),
// meet a key the target gained after the plan (a 500 after data moved, or a silent duplicate where
// the index is missing), or write a label the next run brings back after Operations deleted it.
//
// One run at a time, company-wide, a few minutes long and rare — so the fence is company-wide too:
// a fresh `running` run refuses these writes 409 `ATM_BRANCH_MOVE_RUNNING`, and the reader retries
// after the move. A run left 30 minutes (its process died) no longer holds them — the run lock's
// own takeover rule (branch-move-run.repository.ts `lockHeld`). Not fenced: what files nothing the
// move plans from — an operation opened on a moved machine, a mail ticket (filed under the branch
// a machine works as), a map pin keyed by machine.
import { ErrorCodes } from '@ecms/contracts';
import { AppError } from '../../../shared/errors';
import { atmBranchMoveRunRepository } from './branch-move-run.repository';

/** What the refused write says — the retry is the reader's whole remedy. */
export const BRANCH_MOVE_RUNNING_MESSAGE =
  'يجري الآن نقل بيانات فرع مرتبط في الصراف الآلي. أعد المحاولة بعد انتهاء النقل.';

/** Refuses 409 while a move runs; resolves otherwise. */
export const assertNoBranchMoveRunning = async (now: Date = new Date()): Promise<void> => {
  if (await atmBranchMoveRunRepository.lockHeld(now, null)) {
    throw new AppError(ErrorCodes.ATM_BRANCH_MOVE_RUNNING, 409, BRANCH_MOVE_RUNNING_MESSAGE);
  }
};
