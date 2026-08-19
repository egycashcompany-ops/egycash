// What the captain's day MEANS, as pure functions — so the screen renders a decision it did not
// make and the decision can be tested without a DOM.
//
// NOTHING HERE INVENTS STATE. Every value below is read from the server's answer: `isCaptainOnDay`
// is the crew row, `progress` is the server's own derivation, `executionStatus` is the OP-7 state
// machine. The client's job is to say which of those it is looking at — never to work one out.
import {
  type OperationsExecutionStatus,
  type OperationsMobileDayDto,
  type OperationsMobileStopDto,
} from '@ecms/contracts';

/**
 * The four things a captain's day can BE, which are four different screens.
 *
 * `notCaptain` and `noStops` are separated on purpose and this is the whole reason the server
 * sends `isCaptainOnDay`: both yield an empty `stops`, but one means "you have no duty today" and
 * the other means "you are rostered and dispatch has not given you a stop yet". Telling a rostered
 * captain he has no duty is the failure this distinction exists to prevent — so the day state is
 * read from `isCaptainOnDay`, never from `stops.length`.
 */
export type CaptainDayState = 'noDay' | 'notCaptain' | 'noStops' | 'hasStops';

export const captainDayState = (day: OperationsMobileDayDto): CaptainDayState => {
  // No operating day has been opened at all — a different fact again from "not a captain on it".
  if (day.operationsDayId === null) return 'noDay';
  if (!day.isCaptainOnDay) return 'notCaptain';
  return day.stops.length === 0 ? 'noStops' : 'hasStops';
};

/** The stop the captain is meant to be working, as the SERVER decided it. */
export const currentStop = (day: OperationsMobileDayDto): OperationsMobileStopDto | null =>
  day.stops.find((stop) => stop.assignmentId === day.currentAssignmentId) ?? null;

/**
 * The next act available on a stop, or null when there is none to offer.
 *
 * This mirrors the server's transition table (`execution-state.ts`) rather than adding a second
 * one: every action has exactly one legal predecessor, so the button on screen is the same single
 * move the server would accept. A stop that is not `current` gets NO action regardless of its
 * execution status — the sequential lock is the server's, and the UI must not offer a move it
 * would refuse.
 */
export type CaptainAction = 'start' | 'pickup' | 'deliver' | 'complete';

const NEXT_ACT: Partial<Record<OperationsExecutionStatus, CaptainAction>> = {
  pending: 'start',
  active: 'pickup',
  pickedUp: 'deliver',
  delivered: 'complete',
};

export const nextAction = (stop: OperationsMobileStopDto): CaptainAction | null =>
  stop.progress === 'current' ? (NEXT_ACT[stop.executionStatus] ?? null) : null;

/** How far along the day is, for the header's one-line summary. */
export const dayProgress = (day: OperationsMobileDayDto): { done: number; total: number } => ({
  done: day.stops.filter((stop) => stop.progress === 'completed').length,
  total: day.stops.length,
});
