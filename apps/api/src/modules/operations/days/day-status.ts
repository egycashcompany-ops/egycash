// The operating-day lifecycle (design §16.1) as a pure decision — forward only:
// planning → open → closed. No reopen: the day is NEW (no legacy counterpart), and the approved
// design declares exactly these three states with no way back; adding one would be an invented
// rule, not a port.
import { type OperationsDayStatus } from '@ecms/contracts';

const ALLOWED: Readonly<Record<OperationsDayStatus, readonly OperationsDayStatus[]>> = {
  planning: ['open'],
  open: ['closed'],
  closed: [],
};

export const canTransitionDay = (from: OperationsDayStatus, to: OperationsDayStatus): boolean =>
  ALLOWED[from].includes(to);
