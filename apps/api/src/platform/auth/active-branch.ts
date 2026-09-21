// The branches a caller has narrowed themselves to, read off the request.
//
// BRANCHES, PLURAL. «كل الشاشات دي موجودة عند كل الفروع، الداتا بس اللي بتتغير» — the screens do
// not change from one site to the next, the rows do; so somebody who looks after several sites is
// comparing them, and being made to choose exactly one at a time is being made to do the comparing
// in his head. The header therefore carries a LIST, and one id is simply a list of one, which is
// what every client that predates this sends.
//
// One control in the command bar, one header, one rule: **it can only narrow**. The caller's
// granted scope is the ceiling, so a branch-placed employee is unaffected no matter what they send,
// and an organization-wide account can confine itself to one branch — which is the only way it can
// say where a new document belongs.
//
// Because narrowing is always safe, this needs no permission of its own. What it does need is to
// name a branch that exists and is active, so a stale value left in a browser after a branch is
// retired quietly stops narrowing rather than silently matching nothing.
//
// Validation is cached: the header arrives on every request, the branch list is a handful of rows
// that change once a year, and re-reading it per request would be a query nobody asked for.
import { branchRepository } from '../organization';
import { getCache } from '../../infrastructure/redis/cache';

/**
 * The header the web client sends: one branch id, several separated by commas, or `all` — and
 * `all`, an empty value or no header at all all mean the whole company.
 */
export const ACTIVE_BRANCH_HEADER = 'x-active-branch';

/** More than this in one header is somebody probing, not somebody comparing sites. */
const MAX_SELECTED = 50;

const CACHE_KEY = 'platform:active-branch:v1';
const TTL_SECONDS = 300;

const isObjectId = (value: string): boolean => /^[0-9a-fA-F]{24}$/.test(value);

const readActiveBranchIds = async (): Promise<string[]> => {
  const page = await branchRepository.list({ page: 1, pageSize: 200 });
  return page.items.filter((branch) => branch.status === 'active').map((b) => String(b._id));
};

/** The ids a caller may narrow to — every live, active branch. */
const activeBranchIds = async (): Promise<Set<string>> => {
  const cache = getCache();
  const cached = await cache.get(CACHE_KEY);
  if (cached !== null) return new Set(JSON.parse(cached) as string[]);
  const ids = await readActiveBranchIds();
  await cache.set(CACHE_KEY, JSON.stringify(ids), TTL_SECONDS);
  return new Set(ids);
};

/**
 * Resolve the header into a branch id, or null for "the whole company".
 *
 * Anything unrecognisable — a malformed id, a branch that no longer exists, `all` — resolves to
 * null, which is the unnarrowed view the caller would have had anyway.
 */
/**
 * The header, parsed and held to the caller's ceiling — everything the rule decides, decided.
 *
 * Separate from the lookup below, and deliberately: this is the half that says what a caller MAY
 * narrow to, so it is the half worth proving, and a pure function proves it without a database.
 * What remains after it is only «does this branch still exist».
 */
export const selectableBranches = (
  raw: string | undefined,
  /**
   * The branches the caller's grants reach, when they reach more than one. A multi-branch account
   * may narrow only to those — the reach is the ceiling, exactly as the organization-wide grant is
   * for everybody else — so anything outside it is dropped rather than refused: a stale id left in
   * a browser after a grant was narrowed must not take the branches beside it down with it.
   */
  reach?: readonly string[],
): string[] => {
  if (raw === undefined || raw === '' || raw === 'all') return [];
  return [...new Set(raw.split(',').map((part) => part.trim()).filter((part) => part !== ''))]
    .slice(0, MAX_SELECTED)
    .filter(isObjectId)
    .filter((id) => reach === undefined || reach.length === 0 || reach.includes(id));
};

export const resolveActiveBranches = async (
  raw: string | undefined,
  reach?: readonly string[],
): Promise<string[]> => {
  const asked = selectableBranches(raw, reach);
  if (asked.length === 0) return [];

  const known = await activeBranchIds();
  const hits = asked.filter((id) => known.has(id));
  if (hits.length === asked.length) return hits;

  // A MISS is re-checked against the database before it is dropped. Without this, a branch created
  // a minute ago is offered by the picker — which reads the live list — and then silently ignored
  // here until the cache expires, which reads as "the switcher does nothing". A full hit is the
  // steady state and stays one cached read; a miss costs one query and then caches the new answer.
  const fresh = await readActiveBranchIds();
  await getCache().set(CACHE_KEY, JSON.stringify(fresh), TTL_SECONDS);
  return asked.filter((id) => fresh.includes(id));
};

/**
 * The single branch the caller is narrowed to, or null.
 *
 * Kept because one question genuinely has one answer — «which branch does this NEW document belong
 * to» — and a caller comparing three sites has not answered it. Several selected is therefore the
 * same as none here, and `currentBranchId` falls through to his placement, exactly as it does for
 * a caller who has chosen nothing at all.
 */
export const singleActiveBranch = (ids: readonly string[]): string | null =>
  ids.length === 1 ? (ids[0] ?? null) : null;
