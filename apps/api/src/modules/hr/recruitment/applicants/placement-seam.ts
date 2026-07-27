// Seam for reassignment (RW2), in the style of the stage-materializer seam. Reassignment spans
// every stage — it syncs the scope field on screenings, interviews, evaluations and offers, and
// drives a live offer's revision — so it CANNOT live inside Applicants: the stage features import
// Applicants, and importing them back would close the cycle.
//
// The `placement` feature registers itself here at module load; Applicants just calls the seam, so
// `applicantService.reassign` stays the single public entry point for callers.
//
// The default throws rather than no-ops: a silent success would look like a reassignment that
// never happened. A wiring mistake fails loudly on the first call instead.
import { type ReassignPlacement } from '@ecms/contracts';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';

export type PlacementReassigner = <T>(
  ctx: AuthContext,
  id: string,
  input: ReassignPlacement,
  scope: ScopeSelector,
) => Promise<T>;

const unwired: PlacementReassigner = async () => {
  throw new Error('placement reassignment is not wired — the HR module registers it at boot');
};

let reassigner: PlacementReassigner = unwired;

export const setPlacementReassigner = (fn: PlacementReassigner): void => {
  reassigner = fn;
};

export const resetPlacementReassigner = (): void => {
  reassigner = unwired;
};

export const reassignThroughSeam = <T>(
  ctx: AuthContext,
  id: string,
  input: ReassignPlacement,
  scope: ScopeSelector,
): Promise<T> => reassigner<T>(ctx, id, input, scope);
