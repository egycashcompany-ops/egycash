// The directory register's `anyOfScopes` — a person ANY of several selectors reaches.
//
// IT's people open on the assets', the lines' or the consumables' read grant (2026-11-17), each
// with its own reach, and no single selector can say their union: an `own` grant beside a branch
// grant, two branch grants over different branches. So the repository applies each selector
// exactly as it applies one, and OR-s them. These tests read the filter handed to `list`, so they
// pin the union without a database: never narrower than any one selector, never wider than all.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { type ScopeSelector } from '../../../../shared/types';
import { employeeRepository } from './employee.repository';

const BRANCH_A = '650000000000000000000010';
const BRANCH_B = '650000000000000000000011';
const USER = '650000000000000000000099';

const selector = (over: Partial<ScopeSelector>): ScopeSelector => ({
  scope: 'branch',
  userId: USER,
  branchId: BRANCH_A,
  departmentId: null,
  sectionId: null,
  ...over,
});

const EMPTY_PAGE = { items: [], meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 } };

/** The filter `searchDirectory` hands to `list` for these scopes. */
const filterFor = async (anyOfScopes: readonly ScopeSelector[] | undefined): Promise<unknown> => {
  const list = vi.spyOn(employeeRepository, 'list').mockResolvedValue(EMPTY_PAGE as never);
  await employeeRepository.searchDirectory({ status: 'all', anyOfScopes, page: 1, pageSize: 25 });
  const params = list.mock.calls[0]?.[0] as { filter: unknown; scope?: unknown };
  expect(params).not.toHaveProperty('scope');
  return params.filter;
};

const oid = (id: string) => new Types.ObjectId(id);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('the directory register’s union of scopes', () => {
  it('OR-s each selector exactly as the repository applies it alone', async () => {
    const filter = await filterFor([
      selector({ branchIds: [BRANCH_A, BRANCH_B] }),
      selector({ scope: 'own' }),
    ]);
    expect(filter).toEqual({
      $and: [
        {},
        {
          $or: [
            { branchId: { $in: [oid(BRANCH_A), oid(BRANCH_B)] } },
            { $or: [{ createdBy: oid(USER) }, { userId: oid(USER) }] },
          ],
        },
      ],
    });
  });

  it('keeps two grants over different branches — neither stands for the other', async () => {
    const filter = await filterFor([
      selector({ branchIds: [BRANCH_A, BRANCH_B] }),
      selector({ branchIds: [BRANCH_A] }),
    ]);
    expect(JSON.stringify(filter)).toContain(BRANCH_B);
  });

  it('is one selector’s own filter when only one is given', async () => {
    expect(await filterFor([selector({})])).toEqual({ $and: [{}, { branchId: oid(BRANCH_A) }] });
  });

  it('narrows nothing when any selector is organization-wide', async () => {
    expect(await filterFor([selector({}), selector({ scope: 'organization' })])).toEqual({});
  });

  it('reads an empty list as nobody, never as everybody', async () => {
    const filter = (await filterFor([])) as { $and: unknown[] };
    expect(filter.$and[1]).toEqual({ _id: { $in: [] } });
  });

  it('leaves a search without the field exactly as it was', async () => {
    expect(await filterFor(undefined)).toEqual({});
  });
});
