// "Revoke this role from everyone", as a sequence of single revocations.
//
// There is no bulk endpoint on purpose (decision R1): each revocation is independently authorized,
// independently audited, and independently REFUSED when it would remove the last Super Admin or an
// administrator's own grant. A bulk call would have to re-implement all three and would report one
// outcome for many decisions — and a partial result here is not a broken state, it is exactly the
// set of grants that could legitimately be removed.
//
// Extracted from the screen because the termination argument is the whole of it. Revoked rows LEAVE
// the list, so re-reading the same page number yields what shifted up into it — which is right, and
// which loops forever on a page that produces nothing but refusals. So the cursor advances in that
// case and only that case: every iteration either removes a row (finite: the list is finite) or
// advances the cursor (bounded: by the page count), so the loop cannot run forever.
export interface RevokeAllPage {
  items: { id: string }[];
  meta: { totalPages: number };
}

export interface RevokeAllResult {
  removed: number;
  /**
   * How many GRANTS were refused, not how many refusals were received. A refused grant stays in
   * the list and is therefore met again on the next read of the same page; counting the responses
   * would report "4 refused" for one grant that was tried four times.
   */
  refused: number;
}

export const revokeAllAssignments = async (
  listPage: (page: number) => Promise<RevokeAllPage>,
  revokeOne: (assignmentId: string) => Promise<unknown>,
): Promise<RevokeAllResult> => {
  let removed = 0;
  const refused = new Set<string>();
  let cursor = 1;
  for (;;) {
    const batch = await listPage(cursor);
    if (batch.items.length === 0) break;
    let removedHere = 0;
    // Asking again for a grant the server already refused would be a call whose answer is known.
    for (const assignment of batch.items.filter((row) => !refused.has(row.id))) {
      try {
        await revokeOne(assignment.id);
        removed += 1;
        removedHere += 1;
      } catch {
        refused.add(assignment.id);
      }
    }
    if (removedHere === 0) cursor += 1;
    if (cursor > batch.meta.totalPages) break;
  }
  return { removed, refused: refused.size };
};
