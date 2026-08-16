// Cross-layer label seam for the Job's candidate shifts (P-HR-22, D-JOB-6 option C).
//
// WHY A SEAM AND NOT AN IMPORT. The Job catalog is a PLATFORM surface and shifts belong to the HR
// module, and the boundary rule is one-directional: `{ from: 'platform', allow: ['platform',
// 'shared', 'infrastructure'] }`. Platform may not reach into a module, and lint fails the build
// if it tries. So HR registers a reader here at load time, exactly as it already does for
// employee-code login (`platform/auth/identity-seams.ts`) — the same pattern, for the same reason.
//
// WHY A SEAM AND NOT A PERMISSION. The screen needs to SAY "Morning shift", not to browse the
// shift catalog. Giving the Job screen `attendance.manageShifts` would hand every job editor the
// power to rewrite shifts, and reading a name is not that. The server resolves the names it is
// already allowed to read and hands over labels; the caller gains no reach it did not have.
//
// DEGRADES TO SILENCE, NEVER TO A LIE. Unregistered — an HR module that is disabled — every name
// comes back null, and the DTO says "this id, no name" rather than inventing one or failing the
// request. A deleted shift answers the same way.
import { type LocalizedString } from '@ecms/contracts';

type ShiftLabelReader = (ids: readonly string[]) => Promise<Map<string, LocalizedString>>;

let shiftLabelReader: ShiftLabelReader | null = null;

/** HR registers: shift ids → their names. Idempotent; the last registration wins. */
export const registerShiftLabelReader = (fn: ShiftLabelReader): void => {
  shiftLabelReader = fn;
};

/**
 * Names for these shift ids, as far as anything can say.
 *
 * Missing ids are simply absent from the map — the caller decides what to render, and every
 * caller in this codebase renders `null`, which is the truthful answer to "what is this called?"
 * when nothing can be read.
 */
export const resolveShiftLabels = async (
  ids: readonly string[],
): Promise<Map<string, LocalizedString>> =>
  shiftLabelReader === null || ids.length === 0 ? new Map() : shiftLabelReader(ids);
