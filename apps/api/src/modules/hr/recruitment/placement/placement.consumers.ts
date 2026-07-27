// Registers reassignment with the Applicants seam (RW2), mirroring how the queue materializer
// wires itself. Applicants stays free of any import of the stage features; callers keep using
// `applicantService.reassign` as the single public entry point.
import { setPlacementReassigner } from '../applicants/placement-seam';
import { reassignPlacement } from './placement.service';

let registered = false;

/** Idempotent — safe to call from module load and from tests. */
export const registerPlacementReassignment = (): void => {
  if (registered) return;
  registered = true;
  setPlacementReassigner(
    (ctx, id, input, scope) => reassignPlacement(ctx, id, input, scope) as never,
  );
};
