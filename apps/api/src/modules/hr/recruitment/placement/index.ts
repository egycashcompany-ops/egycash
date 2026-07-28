// Public surface of the Placement feature (RW1–RW5) — reassignment of a live candidate's Position
// and/or Branch. It spans every stage, so it lives OUTSIDE Applicants (which the stage features
// import) and registers itself through the Applicants seam instead. Nothing imports this feature
// except the HR manifest.
export { registerPlacementReassignment } from './placement.consumers';
export { reassignPlacement } from './placement.service';
