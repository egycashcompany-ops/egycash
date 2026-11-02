// The reasons offered when a folder is emptied and the application withdrawn with it.
//
// WHY A LIST AND NOT A FREE BOX. Withdrawing is a terminal move and the reason is what the
// applicant's record carries for the rest of its life — it is read years later by somebody asking
// why this candidate stopped. Typed by hand at the end of a delete confirmation it comes out as
// «حذف» or «لا داعي», which answers nothing. A short list of the reasons this actually happens for
// gets a usable sentence out of one click, and `other` keeps the box for everything else.
//
// WHY THESE KEYS LIVE HERE AND NOT IN `@ecms/contracts`. The API takes the reason as free text —
// `WithdrawApplicantSchema` wants a string between one and five hundred characters and no server
// anywhere knows these keys. Putting the vocabulary in the contracts package would advertise a
// closed set the API does not enforce, so it stays in the screen that offers it, and what travels
// is the sentence the operator read before they clicked.
export const APPLICANT_WITHDRAW_REASONS = [
  'candidateWithdrew',
  'candidateAskedToRemove',
  'unreachable',
  'notSuitable',
  'positionClosed',
  'duplicate',
  'other',
] as const;

export type ApplicantWithdrawReason = (typeof APPLICANT_WITHDRAW_REASONS)[number];

/** The i18n key carrying one reason's sentence, in both languages. */
export const withdrawReasonKey = (reason: ApplicantWithdrawReason): string =>
  `hr.applicantFolders.withdrawReasons.${reason}`;

/**
 * The sentence to send, or `null` when the operator has not said enough to send one.
 *
 * `other` is the only branch that can be empty, and it returns null rather than an empty string so
 * the caller's one check — «is there a reason yet» — covers both «nothing typed» and «nothing
 * chosen». Trimmed, because a reason of three spaces passes `min(1)` on the wire and still says
 * nothing to the person reading the record later.
 */
export const withdrawReasonText = (
  reason: ApplicantWithdrawReason,
  other: string,
  t: (key: string) => string,
): string | null => {
  if (reason !== 'other') return t(withdrawReasonKey(reason));
  const typed = other.trim();
  return typed === '' ? null : typed;
};
