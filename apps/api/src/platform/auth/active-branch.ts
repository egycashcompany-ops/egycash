// The branch a caller has narrowed themselves to, read off the request.
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

/** The header the web client sends. `all` — or nothing — means the whole company. */
export const ACTIVE_BRANCH_HEADER = 'x-active-branch';

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
export const resolveActiveBranch = async (raw: string | undefined): Promise<string | null> => {
  if (raw === undefined || raw === '' || raw === 'all') return null;
  if (!isObjectId(raw)) return null;
  if ((await activeBranchIds()).has(raw)) return raw;

  // A MISS is re-checked against the database before it is refused. Without this, a branch created
  // a minute ago is offered by the picker — which reads the live list — and then silently ignored
  // here until the cache expires, which reads as "the switcher does nothing". A hit is the steady
  // state and stays one cached read; a miss costs one query and then caches the new answer.
  const fresh = await readActiveBranchIds();
  await getCache().set(CACHE_KEY, JSON.stringify(fresh), TTL_SECONDS);
  return fresh.includes(raw) ? raw : null;
};
