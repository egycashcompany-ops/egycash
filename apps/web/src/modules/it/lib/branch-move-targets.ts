// Where «نقل إلى فرع» (assets) and «تحويل إلى فرع» (consumables) may go — one rule for both
// pickers, since both actions ride the one custody grant (`itAsset.assign`, §2.11).
//
// The SERVER says which branches: `GET /it/assets/move-targets` answers the branches the grant
// reaches whole — the very test both actions apply before they write, and answer 403 when it fails.
// The screen cannot work it out itself: `me` carries the reach of ALL the account's grants, so a
// picker built from it offered a branch only another grant reaches, or the branch a
// department-scoped grant merely sits in — and the action then refused it.
//
// What is offered: the branch options (their order and names), kept when the server names them,
// less the branch the things leave — moving them to where they all are is no move.

/**
 * The branches the picker offers, or null while either list is still on its way — the picker
 * waits, rather than saying for a moment that there is nowhere to go.
 *
 * `leaving` is the one branch every picked thing sits in (a consumables transfer always has one;
 * assets from several branches have none, and each of those branches is somewhere for the others).
 */
export const branchMoveTargets = <T extends { id: string }>(
  branches: readonly T[] | undefined,
  reachableIds: readonly string[] | undefined,
  leaving: string | null,
): T[] | null => {
  if (branches === undefined || reachableIds === undefined) return null;
  const reachable = new Set(reachableIds);
  return branches.filter((branch) => reachable.has(branch.id) && branch.id !== leaving);
};
