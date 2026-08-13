// HR's personnel-action authorizer, tested as a pure decision with the data layer mocked (HR3-C).
//
// The integration suite proves this holds over HTTP; this proves the LOGIC in isolation, which is
// what tells a failure apart from a timing or wiring problem when the two disagree.
//
// The decision has two halves and both have to be checked, because either alone lets something
// through: the caller must HOLD a key, and the employee must be REACHABLE under it. A holder of
// `employee.view` for one branch must not read the documents of another, and the scoped lookup is
// the only thing that says so.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findById } = vi.hoisted(() => ({ findById: vi.fn() }));

vi.mock('../employees', () => ({ employeeRepository: { findById } }));
// The service is imported only for its permission list, and importing it for real would drag the
// whole engine — models, event bus, notifications — into a unit test about one predicate.
vi.mock('./employee-action.service', () => ({
  ACTION_GROUP_PERMISSIONS: [
    'employee.manageActions',
    'employee.manageCompensation',
    'employee.exit',
    'employee.rehire',
  ] as const,
}));

const { hrFileEntityAuthorizers } = await import('./employee-action-file-access');

const authorizer = hrFileEntityAuthorizers[0];
if (authorizer === undefined) throw new Error('no authorizer registered');

const ctx = (permissions: Record<string, string>) => ({ userId: 'u1', permissions }) as never;

const EMPLOYEE = { _id: 'E1' };

beforeEach(() => {
  findById.mockReset();
});

describe('the entity type it claims', () => {
  // A type minted by this phase. Reusing `employee` would have retro-guarded every file already
  // filed against an employee, which is a change to behaviour nobody asked for.
  it('is the attachment type, not the employee itself', () => {
    expect(authorizer.entityType).toBe('employeeActionAttachment');
    expect(hrFileEntityAuthorizers).toHaveLength(1);
  });
});

describe('reading a personnel-action document', () => {
  it('allows a caller who can see the employee', async () => {
    findById.mockResolvedValue(EMPLOYEE);
    const allowed = await authorizer.authorize({
      ctx: ctx({ 'employee.view': 'organization' }),
      entityId: 'E1',
      intent: 'read',
    });
    expect(allowed).toBe(true);
  });

  // Out of scope comes back null from the scoped lookup — the same reason the employee endpoint
  // answers 404 for another branch's record.
  it('denies when the employee is out of the caller’s scope', async () => {
    findById.mockResolvedValue(null);
    const allowed = await authorizer.authorize({
      ctx: ctx({ 'employee.view': 'branch' }),
      entityId: 'E1',
      intent: 'read',
    });
    expect(allowed).toBe(false);
  });

  it('denies a caller without the key at all, without even asking the database', async () => {
    const allowed = await authorizer.authorize({
      ctx: ctx({}),
      entityId: 'E1',
      intent: 'read',
    });
    expect(allowed).toBe(false);
    expect(findById).not.toHaveBeenCalled();
  });
});

describe('filing a new one', () => {
  /**
   * Uploading a document IS proposing a personnel action, so reading is not enough for it.
   * Someone who may look at an employee's history must not be able to put a paper into it.
   */
  it('denies a caller who can only VIEW the employee', async () => {
    findById.mockResolvedValue(EMPLOYEE);
    const allowed = await authorizer.authorize({
      ctx: ctx({ 'employee.view': 'organization' }),
      entityId: 'E1',
      intent: 'write',
    });
    expect(allowed).toBe(false);
  });

  it('allows any ONE of the four action groups', async () => {
    for (const key of [
      'employee.manageActions',
      'employee.manageCompensation',
      'employee.exit',
      'employee.rehire',
    ]) {
      findById.mockResolvedValue(EMPLOYEE);
      const allowed = await authorizer.authorize({
        ctx: ctx({ [key]: 'organization' }),
        entityId: 'E1',
        intent: 'write',
      });
      expect(allowed, key).toBe(true);
    }
  });

  // Holding the key is not the same as reaching the employee, and this is the case that separates
  // them: full permission, wrong branch.
  it('denies a group holder whose scope does not reach this employee', async () => {
    findById.mockResolvedValue(null);
    const allowed = await authorizer.authorize({
      ctx: ctx({ 'employee.exit': 'branch' }),
      entityId: 'E1',
      intent: 'write',
    });
    expect(allowed).toBe(false);
  });
});
