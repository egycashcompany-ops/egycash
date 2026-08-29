// The words an automatic closeout writes on a row it closed (P-HR-SEP D2).
//
// WHY THIS IS A CONSTANT AND NOT THREE STRING LITERALS. Every consumer of `hr.employee.exited`
// writes a status change nobody asked for, on a row somebody will read months later without any
// memory of the exit. A status change with no reason on it is indistinguishable from a person's
// decision — so each one states its cause, and they state it in the SAME words, because «employee
// exited», «employee left» and «exited» in three different collections would read like three
// different things having happened.
//
// Leave got here first and wrote this literal on its cancellations; this names what it already
// says rather than inventing a fourth phrasing beside it.
//
// ENGLISH, LIKE EVERY OTHER STORED REASON IN THIS SYSTEM. The row is a record, not a screen: the
// Arabic a user reads is a label chosen at render time, and a translated string frozen into a
// document is one that cannot be re-translated when somebody changes their mind about the wording.
export const EXITED_REASON = 'employee exited';
