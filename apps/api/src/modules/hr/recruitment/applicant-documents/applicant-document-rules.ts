// What this candidate owes, and whether they may still do anything about it.
//
// Pure on purpose, and for the usual reason: every one of these answers is a rule somebody agreed
// to in a meeting, and a rule that can only be exercised by uploading a real file to a real
// database is a rule nobody re-reads. Nothing here touches Mongo, the Files service, or a clock it
// did not receive.
import {
  type ApplicantDocumentApplicability,
  type ApplicantDocumentReviewStatus,
} from '@ecms/contracts';

/** The half of a catalogue row these rules need. Deliberately not the Mongoose document. */
export interface DocumentTypeFacts {
  id: string;
  key: string;
  applicability: ApplicantDocumentApplicability;
  required: boolean;
  licenseClassRequired: boolean;
  order: number;
  active: boolean;
}

/** The half of a handed-in document these rules need. */
export interface HandedInFacts {
  typeId: string;
  status: ApplicantDocumentReviewStatus;
}

/**
 * Which catalogue rows are asked of THIS candidate (D-APP-5).
 *
 * `driversOnly` is answered by the seat — the job title's `requiresDrivingTest` — and never by
 * what the candidate typed into their form. Somebody applying to drive who has not entered a
 * licence number is still applying to drive; asking their form instead of their job title would
 * quietly excuse exactly the person the rule exists for.
 *
 * Inactive rows are excluded here rather than deleted anywhere: a type that stops being required
 * next year must still be readable on the sets that already reference it.
 */
export const typesFor = (
  catalogue: readonly DocumentTypeFacts[],
  isDriver: boolean,
): DocumentTypeFacts[] =>
  catalogue
    .filter((type) => type.active && (type.applicability === 'all' || isDriver))
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

/**
 * May the CANDIDATE replace what is in this slot? (D-APP-7 / D-APP-7ج)
 *
 * `pending` — yes, nobody has ruled on it yet and a better photograph is strictly an improvement.
 *
 * `accepted` — no. It is fixed, and that is the point: a document somebody in HR looked at and
 * approved must not be swappable underneath them afterwards. Changing it is a request now, not an
 * act.
 *
 * `rejected` — YES, and this is the decision that makes the refusal useful. HR refusing a blurred
 * photograph means «hand in a better one»; a refusal that also locked the slot would leave the
 * candidate stuck at a door only a member of staff could open, which is the opposite of what the
 * refusal was for.
 */
export const mayReplace = (status: ApplicantDocumentReviewStatus): boolean => status !== 'accepted';

/** May HR rule on this slot? Only what is still waiting — re-deciding a settled slot is not a review. */
export const mayReview = (status: ApplicantDocumentReviewStatus): boolean => status === 'pending';

/**
 * The rows asked of this candidate that they have not filled.
 *
 * A REFUSED slot is not missing: the candidate handed something in and it is sitting there with a
 * reason attached. Counting it as missing would tell them they had never uploaded it and lose the
 * note explaining what was wrong.
 */
export const missingFor = (
  asked: readonly DocumentTypeFacts[],
  handedIn: readonly HandedInFacts[],
): DocumentTypeFacts[] => {
  const filled = new Set(handedIn.map((doc) => doc.typeId));
  return asked.filter((type) => !filled.has(type.id));
};

/**
 * Is the candidate's side finished?
 *
 * Every REQUIRED row is filled and nothing they handed in stands refused. Pending is fine — the
 * candidate has done their part and is waiting on the company, which is a different state from
 * owing something.
 */
export const isComplete = (
  asked: readonly DocumentTypeFacts[],
  handedIn: readonly HandedInFacts[],
): boolean => {
  const byType = new Map(handedIn.map((doc) => [doc.typeId, doc.status]));
  return asked.every((type) => {
    const status = byType.get(type.id);
    if (status === undefined) return !type.required;
    return status !== 'rejected';
  });
};

/** How many handed-in documents are still waiting on somebody in HR. */
export const pendingReviewCount = (handedIn: readonly HandedInFacts[]): number =>
  handedIn.filter((doc) => doc.status === 'pending').length;

/**
 * Does the class the candidate stated match what the slot asks for? (D-APP-6)
 *
 * Both directions are wrong and both are refused: a professional licence handed in with no class
 * is an unanswered question, and a class stated on a birth certificate is a field that has no
 * meaning there. The VALUES are already impossible to get wrong — the schema admits two.
 */
export const licenseClassProblem = (
  type: Pick<DocumentTypeFacts, 'licenseClassRequired'>,
  licenseClass: string | undefined,
): 'missing' | 'unexpected' | null => {
  if (type.licenseClassRequired) return licenseClass === undefined ? 'missing' : null;
  return licenseClass === undefined ? null : 'unexpected';
};
