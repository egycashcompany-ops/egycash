// Emptying a candidate's folder — the decision, with every edge mocked.
//
// Five things are pinned here, and each is a sentence somebody has to be able to read back:
//   (a) nobody without `applicantDocument.delete` gets past the file authorizer;
//   (b) a HIRED candidate's folder is a kept record and is refused by CODE, not by a message;
//   (c) exactly the files of the applicant asked for are soft-deleted, and no others;
//   (d) one audit row is written for the act, naming the applicant and the count;
//   (e) a bulk delete empties what it may and names what it would not touch;
//   (f) the application is withdrawn with the folder when asked, under its own key, and never for
//       a folder that was refused;
//   (g) an emptied folder leaves the grid, and comes back if anything is filed for that person.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes, nationalIdCardTag } from '@ecms/contracts';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../../../shared/errors';

const mocks = vi.hoisted(() => {
  /** A mongoose query builder that answers whatever its call site was told to answer. */
  const chain = (produce: () => unknown): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    for (const key of ['sort', 'skip', 'limit', 'select', 'lean', 'populate']) self[key] = () => self;
    self.exec = async () => produce();
    return self;
  };
  return {
    chain,
    audit: vi.fn(),
    listFiles: vi.fn(),
    softDelete: vi.fn(),
    ensureCategory: vi.fn(),
    cardCategory: vi.fn(),
    getUser: vi.fn(),
    applicantFindOne: vi.fn(),
    applicantFind: vi.fn(),
    applicantCount: vi.fn(),
    markFolderEmptied: vi.fn(),
    withdraw: vi.fn(),
    liveFileOwners: vi.fn(),
    softDeleteSet: vi.fn(),
    setFindOne: vi.fn(),
    employed: vi.fn(),
    offered: vi.fn(),
  };
});

vi.mock('../../../../platform/audit', () => ({ auditService: { record: mocks.audit } }));
vi.mock('../../../../platform/files', () => ({
  fileService: {
    list: mocks.listFiles,
    softDelete: mocks.softDelete,
    entityIdsWithLiveFiles: mocks.liveFileOwners,
    toDto: (file: unknown) => file,
  },
  fileCategoryService: { ensure: mocks.ensureCategory },
}));
vi.mock('../../../../platform/users', () => ({ userService: { getById: mocks.getUser } }));
// The barrel boots the whole portal service; the constant is all this slice needs from it.
vi.mock(
  '../applicant-portal',
  async () => await import('../applicant-portal/applicant-portal.constants'),
);
vi.mock('../applicants/applicant.model', () => ({
  ApplicantModel: {
    findOne: (...args: unknown[]) => mocks.chain(() => mocks.applicantFindOne(...args)),
    find: (...args: unknown[]) => mocks.chain(() => mocks.applicantFind(...args)),
    countDocuments: (...args: unknown[]) => mocks.chain(() => mocks.applicantCount(...args)),
  },
}));
vi.mock('../applicants/applicant.repository', () => ({
  applicantRepository: { markDocumentsFolderEmptied: mocks.markFolderEmptied },
}));
// Reached by a DEFERRED import inside the service, so the whole applicant stage is not dragged in
// front of this module — `vi.mock` intercepts it either way.
vi.mock('../applicants/applicant.service', () => ({
  applicantService: { withdraw: mocks.withdraw },
}));
vi.mock('../applicants/national-id-card.files', () => ({
  resolveNationalIdCardCategoryId: mocks.cardCategory,
}));
vi.mock('../../employee-management/employees/employee.repository', () => ({
  employeeRepository: { findApplicantIdsWithEmployeeSystem: mocks.employed },
}));
vi.mock('../job-offers/job-offer.repository', () => ({
  jobOfferRepository: { findApplicantIdsWithAcceptedOffer: mocks.offered },
}));
vi.mock('./applicant-document.model', () => ({
  ApplicantDocumentSetModel: {
    findOne: (...args: unknown[]) => mocks.chain(() => mocks.setFindOne(...args)),
  },
}));
vi.mock('./applicant-document.repository', () => ({
  applicantDocumentRepository: { softDeleteForApplicant: mocks.softDeleteSet },
}));

const { applicantFolderService } = await import('./applicant-folder.service');
const { hrApplicantDocumentFileAuthorizers } = await import('./applicant-document.files');

const CARD_CATEGORY = String(new Types.ObjectId());
const ACTOR = String(new Types.ObjectId());

/** The caller: HR, holding the delete key and nothing else. */
const ctx = {
  userId: ACTOR,
  sessionId: 's1',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: { 'applicantDocument.delete': 'organization' },
  permissionVersion: 1,
  isPrivileged: false,
} as never;

const applicant = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  code: 'APP-00001',
  fullNameAr: 'محمد أحمد',
  status: 'screened',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  isDeleted: false,
  ...over,
});

const file = (entityId: string, over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  entityRef: { moduleId: 'hr', entityType: 'applicant', entityId },
  categoryId: new Types.ObjectId(CARD_CATEGORY),
  tags: [nationalIdCardTag('front')],
  ...over,
});

/** `fileService.list` answers per applicant, so «whose files went» is an assertion. */
const folders = new Map<string, { _id: Types.ObjectId }[]>();

beforeEach(() => {
  vi.clearAllMocks();
  folders.clear();
  mocks.cardCategory.mockResolvedValue(CARD_CATEGORY);
  mocks.employed.mockResolvedValue(new Set<string>());
  mocks.offered.mockResolvedValue(new Set<string>());
  mocks.softDeleteSet.mockResolvedValue(0);
  mocks.softDelete.mockResolvedValue(undefined);
  mocks.markFolderEmptied.mockResolvedValue(undefined);
  mocks.withdraw.mockResolvedValue(undefined);
  mocks.liveFileOwners.mockResolvedValue(new Set<string>());
  mocks.setFindOne.mockResolvedValue(null);
  mocks.listFiles.mockImplementation(async (query: { entityId?: string }) => ({
    items: folders.get(query.entityId ?? '') ?? [],
    meta: {},
  }));
});

/** The file ids `fileService.softDelete` was actually asked to remove, in order. */
const softDeleted = (): string[] =>
  mocks.softDelete.mock.calls.map(([, id]) => id as string);

describe('(a) the key is the gate — the authorizer, asked straight', () => {
  const authorizer = hrApplicantDocumentFileAuthorizers[0];

  beforeEach(() => {
    // Staff, not a portal account: no external subject on the user record.
    mocks.getUser.mockResolvedValue({ externalSubject: null });
  });

  it('refuses a caller holding no applicantDocument.delete', async () => {
    await expect(
      authorizer?.authorize({
        ctx: { userId: ACTOR, permissions: {} } as never,
        entityId: String(new Types.ObjectId()),
        intent: 'delete',
      }),
    ).resolves.toBe(false);
  });

  it('refuses the REVIEW key for a delete — reviewing and emptying are different acts', async () => {
    await expect(
      authorizer?.authorize({
        ctx: { userId: ACTOR, permissions: { 'applicantDocument.review': 'organization' } } as never,
        entityId: String(new Types.ObjectId()),
        intent: 'delete',
      }),
    ).resolves.toBe(false);
  });

  it('allows the delete key, and still refuses it a WRITE', async () => {
    const asked = { ctx, entityId: String(new Types.ObjectId()) };
    await expect(authorizer?.authorize({ ...asked, intent: 'delete' })).resolves.toBe(true);
    await expect(authorizer?.authorize({ ...asked, intent: 'write' })).resolves.toBe(false);
  });

  it('tells the platform it understands a delete — or the platform would ask it about a write', () => {
    expect(authorizer?.understandsDelete).toBe(true);
  });
});

describe('(b) a kept record refuses, whatever key the caller holds', () => {
  it('refuses a HIRED applicant with APPLICANT_FOLDER_KEPT_RECORD, and removes nothing', async () => {
    const hired = applicant({ status: 'hired' });
    mocks.applicantFindOne.mockResolvedValue(hired);
    folders.set(String(hired._id), [file(String(hired._id))]);

    await expect(
      applicantFolderService.deleteFolder(ctx, String(hired._id)),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(applicantFolderService.deleteFolder(ctx, String(hired._id))).rejects.toMatchObject(
      { code: ErrorCodes.APPLICANT_FOLDER_KEPT_RECORD, httpStatus: 422 },
    );
    expect(mocks.softDelete).not.toHaveBeenCalled();
    expect(mocks.softDeleteSet).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('refuses an applicant who already has an employee row, and one holding an accepted offer', async () => {
    const one = applicant();
    mocks.applicantFindOne.mockResolvedValue(one);
    mocks.employed.mockResolvedValue(new Set([String(one._id)]));
    await expect(
      applicantFolderService.deleteFolder(ctx, String(one._id)),
    ).rejects.toMatchObject({ code: ErrorCodes.APPLICANT_FOLDER_KEPT_RECORD });

    mocks.employed.mockResolvedValue(new Set<string>());
    mocks.offered.mockResolvedValue(new Set([String(one._id)]));
    await expect(
      applicantFolderService.deleteFolder(ctx, String(one._id)),
    ).rejects.toMatchObject({ code: ErrorCodes.APPLICANT_FOLDER_KEPT_RECORD });
    expect(mocks.softDelete).not.toHaveBeenCalled();
  });

  it('answers 404 for an applicant who is not there', async () => {
    mocks.applicantFindOne.mockResolvedValue(null);
    await expect(
      applicantFolderService.deleteFolder(ctx, String(new Types.ObjectId())),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('(c) exactly this applicant’s files, and (d) one row for the act', () => {
  it('soft-deletes the folder’s files — the set row FIRST, nobody else’s file at all', async () => {
    const mine = applicant();
    const neighbour = applicant({ code: 'APP-00002' });
    const mineId = String(mine._id);
    const theirs = String(neighbour._id);
    const card = file(mineId);
    const handedIn = file(mineId, {
      entityRef: { moduleId: 'hr', entityType: 'applicantDocuments', entityId: mineId },
      categoryId: new Types.ObjectId(),
      tags: [],
    });
    // Filed against the applicant by another feature — not part of the folder, so not touched.
    const elsewhere = file(mineId, {
      entityRef: { moduleId: 'hr', entityType: 'interview', entityId: mineId },
    });
    folders.set(mineId, [card, handedIn, elsewhere]);
    folders.set(theirs, [file(theirs), file(theirs)]);
    mocks.applicantFindOne.mockResolvedValue(mine);
    mocks.softDeleteSet.mockResolvedValue(1);

    const result = await applicantFolderService.deleteFolder(ctx, mineId);

    expect(softDeleted()).toEqual([String(card._id), String(handedIn._id)]);
    expect(softDeleted()).not.toContain(String(elsewhere._id));
    for (const other of folders.get(theirs) ?? []) {
      expect(softDeleted()).not.toContain(String(other._id));
    }
    expect(mocks.softDelete).toHaveBeenCalledWith(ctx, String(card._id));
    // The pointers go before the bytes: the set row is dropped before any file is.
    expect(mocks.softDeleteSet).toHaveBeenCalledWith(mineId, ACTOR);
    expect(mocks.softDeleteSet.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.softDelete.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(mocks.markFolderEmptied).toHaveBeenCalledWith(mineId);
    expect(result).toEqual({
      applicantId: mineId,
      applicantCode: 'APP-00001',
      applicantName: 'محمد أحمد',
      filesRemoved: 2,
      // Nobody asked for a withdrawal here, and the answer says so rather than leaving the caller
      // to assume it from the absence of a field.
      withdrawn: false,
    });
  });

  it('writes ONE audit row for the act, against the applicant, naming what went', async () => {
    const mine = applicant();
    const mineId = String(mine._id);
    folders.set(mineId, [file(mineId), file(mineId)]);
    mocks.applicantFindOne.mockResolvedValue(mine);

    await applicantFolderService.deleteFolder(ctx, mineId);

    expect(mocks.audit).toHaveBeenCalledTimes(1);
    const [entry] = mocks.audit.mock.calls[0] as [
      {
        entityRef: { moduleId: string; entityType: string; entityId: string };
        action: string;
        changes: { field: string; old: unknown; new: unknown }[];
      },
    ];
    expect(entry.entityRef).toEqual({
      moduleId: 'hr',
      entityType: 'applicant',
      entityId: mineId,
    });
    // Its OWN action, not the platform's bare `delete`: the per-file rows already say that, and
    // «who emptied this person's folder» is the question an HR review asks.
    expect(entry.action).toBe('applicantFolderDeleted');
    expect(entry.changes).toEqual([
      { field: 'documentsFolder', old: '2 files', new: null },
      { field: 'filesRemoved', old: null, new: 2 },
      { field: 'applicantCode', old: null, new: 'APP-00001' },
    ]);
  });

  it('counts only what actually went when one file refuses, and still finishes the folder', async () => {
    const mine = applicant();
    const mineId = String(mine._id);
    const [a, b] = [file(mineId), file(mineId)];
    folders.set(mineId, [a, b]);
    mocks.applicantFindOne.mockResolvedValue(mine);
    mocks.softDelete.mockRejectedValueOnce(new Error('already gone'));

    const result = await applicantFolderService.deleteFolder(ctx, mineId);

    expect(softDeleted()).toEqual([String(a._id), String(b._id)]);
    expect(result.filesRemoved).toBe(1);
  });
});

describe('(e) several folders at once — partial on purpose', () => {
  it('empties what it may, names what it would not, and skips an id that is nobody', async () => {
    const ok1 = applicant({ code: 'APP-00010' });
    const ok2 = applicant({ code: 'APP-00011' });
    const kept = applicant({ code: 'APP-00012', status: 'hired' });
    const ghost = String(new Types.ObjectId());
    for (const one of [ok1, ok2, kept]) folders.set(String(one._id), [file(String(one._id))]);
    mocks.applicantFind.mockResolvedValue([ok1, ok2, kept]);

    const result = await applicantFolderService.deleteFolders(ctx, [
      String(ok1._id),
      String(ok2._id),
      String(kept._id),
      ghost,
    ]);

    expect(result.deleted.map((d) => d.applicantCode)).toEqual(['APP-00010', 'APP-00011']);
    expect(result.deleted.every((d) => d.filesRemoved === 1)).toBe(true);
    expect(result.refused).toEqual([
      {
        applicantId: String(kept._id),
        applicantCode: 'APP-00012',
        applicantName: 'محمد أحمد',
        reason: 'hired',
      },
    ]);
    // The kept record's file is untouched; the ghost produced neither a delete nor a refusal.
    const keptFile = folders.get(String(kept._id))?.[0];
    expect(softDeleted()).not.toContain(String(keptFile?._id));
    expect(softDeleted()).toHaveLength(2);
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain(ghost);
  });

  it('asks the two page-at-once guards ONCE for the whole selection', async () => {
    const ok1 = applicant();
    const ok2 = applicant({ code: 'APP-00021' });
    mocks.applicantFind.mockResolvedValue([ok1, ok2]);

    await applicantFolderService.deleteFolders(ctx, [String(ok1._id), String(ok2._id)]);

    expect(mocks.employed).toHaveBeenCalledTimes(1);
    expect(mocks.offered).toHaveBeenCalledTimes(1);
    expect(mocks.employed).toHaveBeenCalledWith([String(ok1._id), String(ok2._id)]);
  });
});

describe('(f) withdrawing the application with the folder', () => {
  /** The same caller, now also holding the key withdrawing needs. */
  const editor = {
    ...(ctx as unknown as Record<string, unknown>),
    permissions: { 'applicantDocument.delete': 'organization', 'applicant.edit': 'organization' },
  } as never;
  const scope = { scope: 'organization', userId: ACTOR, branchId: null } as never;
  const asking = { withdraw: { reason: 'انسحب المتقدم من التقديم', scope } };

  it('does not touch the lifecycle when nobody asked', async () => {
    const mine = applicant();
    folders.set(String(mine._id), [file(String(mine._id))]);
    mocks.applicantFindOne.mockResolvedValue(mine);

    const result = await applicantFolderService.deleteFolder(editor, String(mine._id));

    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(result.withdrawn).toBe(false);
  });

  it('goes through the applicants service, with the reason, the version and the caller’s scope', async () => {
    const mine = applicant({ __v: 7 });
    folders.set(String(mine._id), [file(String(mine._id))]);
    mocks.applicantFindOne.mockResolvedValue(mine);

    const result = await applicantFolderService.deleteFolder(editor, String(mine._id), asking);

    expect(mocks.withdraw).toHaveBeenCalledWith(
      editor,
      String(mine._id),
      { reason: 'انسحب المتقدم من التقديم', version: 7 },
      scope,
    );
    expect(result.withdrawn).toBe(true);
  });

  /**
   * The refusal is the point. `applicantDocument.delete` buys emptying a folder, not moving
   * somebody's application to a terminal state — and the request is refused WHOLE, so a caller
   * cannot lose the files to a request that was going to be half-performed anyway.
   */
  it('refuses the whole request when the caller lacks applicant.edit, deleting nothing', async () => {
    const mine = applicant();
    folders.set(String(mine._id), [file(String(mine._id))]);
    mocks.applicantFindOne.mockResolvedValue(mine);

    await expect(
      applicantFolderService.deleteFolder(ctx, String(mine._id), asking),
    ).rejects.toThrow(ForbiddenError);
    expect(softDeleted()).toHaveLength(0);
    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('counts an already-withdrawn candidate as withdrawn without a second transition', async () => {
    const mine = applicant({ status: 'withdrawn' });
    folders.set(String(mine._id), [file(String(mine._id))]);
    mocks.applicantFindOne.mockResolvedValue(mine);

    const result = await applicantFolderService.deleteFolder(editor, String(mine._id), asking);

    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(result.withdrawn).toBe(true);
  });

  /**
   * The files are already gone by the time the lifecycle is asked, so a refusal there cannot be
   * allowed to answer as though nothing had happened. It is reported instead.
   */
  it('still empties the folder when the lifecycle refuses the move, and says so', async () => {
    const mine = applicant();
    folders.set(String(mine._id), [file(String(mine._id))]);
    mocks.applicantFindOne.mockResolvedValue(mine);
    mocks.withdraw.mockRejectedValueOnce(new Error('stale version'));

    const result = await applicantFolderService.deleteFolder(editor, String(mine._id), asking);

    expect(result.filesRemoved).toBe(1);
    expect(result.withdrawn).toBe(false);
  });

  /**
   * A kept record is somebody who was hired or is being hired. Withdrawing them would be the
   * opposite of true, and it is the one thing here worse than doing nothing.
   */
  it('never withdraws an applicant whose folder it refused to empty', async () => {
    const ok = applicant({ code: 'APP-00030' });
    const kept = applicant({ code: 'APP-00031', status: 'hired' });
    for (const one of [ok, kept]) folders.set(String(one._id), [file(String(one._id))]);
    mocks.applicantFind.mockResolvedValue([ok, kept]);
    // The withdrawal re-reads the applicant to take its version from the freshest row.
    mocks.applicantFindOne.mockResolvedValue(ok);

    const result = await applicantFolderService.deleteFolders(
      editor,
      [String(ok._id), String(kept._id)],
      asking,
    );

    expect(mocks.withdraw).toHaveBeenCalledTimes(1);
    expect(mocks.withdraw).toHaveBeenCalledWith(editor, String(ok._id), expect.anything(), scope);
    expect(result.deleted.map((d) => d.withdrawn)).toEqual([true]);
    expect(result.refused.map((r) => r.applicantCode)).toEqual(['APP-00031']);
  });
});

describe('(g) an emptied folder leaves the grid', () => {
  /** The filter the page itself was read with — the second `find`, not the nomination probe. */
  const pageFilter = (): Record<string, unknown> => {
    const call = mocks.applicantFind.mock.calls.find(
      ([filter]) => (filter as Record<string, unknown>).documentsFolderDeletedAt === undefined,
    );
    return (call?.[0] ?? {}) as Record<string, unknown>;
  };

  const listOnce = async (nominated: { _id: Types.ObjectId }[]): Promise<void> => {
    mocks.applicantFind.mockImplementation(async (filter: Record<string, unknown>) =>
      filter.documentsFolderDeletedAt === undefined ? [] : nominated,
    );
    mocks.applicantCount.mockResolvedValue(0);
    await applicantFolderService.list({ page: 1, pageSize: 24 } as never);
  };

  it('asks only about the folders it emptied, by the date the partial index holds', async () => {
    const emptied = { _id: new Types.ObjectId() };
    await listOnce([emptied]);

    expect(mocks.applicantFind).toHaveBeenCalledWith(
      expect.objectContaining({ documentsFolderDeletedAt: { $type: 'date' } }),
    );
    expect(mocks.liveFileOwners).toHaveBeenCalledWith(
      'hr',
      ['applicant', 'applicantDocuments'],
      [String(emptied._id)],
    );
  });

  it('leaves an emptied folder out of the page', async () => {
    const emptied = { _id: new Types.ObjectId() };
    await listOnce([emptied]);

    expect(pageFilter()._id).toEqual({ $nin: [emptied._id] });
  });

  /**
   * The marker NOMINATES, the files DECIDE. File anything new for somebody whose folder was
   * emptied last year and their folder is back — with nothing to reset, and no way for a stale
   * marker to hide a folder that has papers in it.
   */
  it('brings a folder back the moment anything is filed for that person again', async () => {
    const refilled = { _id: new Types.ObjectId() };
    mocks.liveFileOwners.mockResolvedValue(new Set([String(refilled._id)]));
    await listOnce([refilled]);

    expect(pageFilter()._id).toBeUndefined();
  });

  it('does not ask the Files service anything when it has emptied nothing', async () => {
    await listOnce([]);

    expect(mocks.liveFileOwners).not.toHaveBeenCalled();
    expect(pageFilter()._id).toBeUndefined();
  });
});
