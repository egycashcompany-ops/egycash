// Seam for opening the applicant's next stage queue row (I11), in the style of the OCR and
// requisition seams. The Applicants feature must not import the stage features (they import it),
// so the materializer registers itself here at module load and Applicants simply calls the seam.
//
// The default is a no-op, so the aggregate works standalone in unit tests.
export type StageMaterializer = (applicantId: string) => Promise<void>;

const noop: StageMaterializer = async () => undefined;

let onRegistered: StageMaterializer = noop;
let onMovedToOffer: StageMaterializer = noop;

export const setStageMaterializer = (hooks: {
  onRegistered?: StageMaterializer;
  onMovedToOffer?: StageMaterializer;
}): void => {
  if (hooks.onRegistered !== undefined) onRegistered = hooks.onRegistered;
  if (hooks.onMovedToOffer !== undefined) onMovedToOffer = hooks.onMovedToOffer;
};

export const resetStageMaterializer = (): void => {
  onRegistered = noop;
  onMovedToOffer = noop;
};

export const materializeAfterRegistration = (applicantId: string): Promise<void> =>
  onRegistered(applicantId);

export const materializeAfterMoveToOffer = (applicantId: string): Promise<void> =>
  onMovedToOffer(applicantId);
