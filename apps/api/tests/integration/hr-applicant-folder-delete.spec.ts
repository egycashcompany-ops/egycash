// Emptying an applicant's documents folder, end to end — the half only a running server answers.
//
// Three of the claims here cannot be made anywhere else:
//
//   · a candidate's handed-in document is reachable by NO staff write (`applicant-document.files.ts`
//     refuses every `write` intent, and that refusal is the whole reason the file exists), so
//     whether a delete gets through at all is decided by the platform's authorizer registry rather
//     than by this module's code;
//   · the SET ROW must go with the bytes. A row still naming a soft-deleted file leaves the slot
//     bricked — the reviewer's queue goes on showing the document as waiting and the candidate's
//     next upload is refused — and nothing throws, so only a re-upload discovers it;
//   · the guard reads three different collections, and the clause that matters most is the one
//     about a row in ANOTHER module.
//
// The three applicants are deliberately kept apart: the one whose folder is emptied, the one that
// proves nothing else was touched, and the one who was hired.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  ErrorCodes,
  platformPermissions,
  SettingKeys,
  type ApplicantDocumentSetDto,
  type ApplicantDocumentTypeDto,
  type ApplicantDto,
  type ApplicantFolderDeleteBlock,
  type ApplicantFolderDetailDto,
  type ApplicantFolderDto,
  type DeleteApplicantFoldersResultDto,
  type DeletedApplicantFolderDto,
  type FileDto,
  type ScreeningDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { APPLICANT_PORTAL_SUBJECT } from '../../src/modules/hr/recruitment/applicant-portal';
import { ApplicantModel } from '../../src/modules/hr/recruitment/applicants/applicant.model';
import { resolveNationalIdCardCategoryId } from '../../src/modules/hr/recruitment/applicants/national-id-card.files';
import { ApplicantDocumentSetModel } from '../../src/modules/hr/recruitment/applicant-documents/applicant-document.model';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { JobOfferModel } from '../../src/modules/hr/recruitment/job-offers/job-offer.model';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { fileCategoryService } from '../../src/platform/files';
import { FileModel } from '../../src/platform/files/file.model';
import { rbacService } from '../../src/platform/rbac';
import { authService } from '../../src/platform/auth';
import { userService, type UserDoc } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { mutated } from './helpers/workflow-envelope';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
/** Holds `applicantDocument.view` and `.review` and NOT `.delete` — the refusal under test. */
let readerToken: string;
/** Holds `applicantDocument.delete` and NOT `applicant.edit` — may empty, may not withdraw. */
let emptierToken: string;
let generalCategoryId: string;

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const code = (res: request.Response): string =>
  (res.body as { error?: { code?: string } }).error?.code ?? '';

const waitFor = async (predicate: () => Promise<boolean>, ms = 2000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-applicant-folder-delete-${String(Date.now())}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const account = async (email: string, roleId: string): Promise<string> => {
  const { user: created } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'A' },
      lastName: { ar: 'م', en: 'A' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const id = String(created._id);
  await userService.setPassword(id, PASSWORD, 'passwordReset');
  await userService.forceActivate(id);
  await rbacService.ensureAssignment(id, roleId, 'organization');
  return id;
};

const login = async (email: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status, `login ${email}`).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

const registerApplicant = async (nationalId: string, phone: string): Promise<ApplicantDto> => {
  const sources = await request(app)
    .get('/api/v1/hr/applicant-sources')
    .query({ pageSize: 50 })
    .set('Authorization', `Bearer ${adminToken}`);
  const source = data<{ id: string; key: string }[]>(sources).find((s) => s.key === 'internalHr');
  if (source === undefined) throw new Error('source internalHr not seeded');
  const res = await request(app)
    .post('/api/v1/hr/applicants')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      sourceId: source.id,
      intakeChannel: 'internal',
      identity: { fullNameAr: 'محمد أحمد عبد الله سالم', nationality: 'Egyptian', nationalId },
      contact: { primaryPhone: phone },
    });
  expect(res.status, 'register applicant').toBe(201);
  return mutated<ApplicantDto>(res);
};

/** An HR attachment and a card image — both filed against the applicant, both in the folder. */
const attach = async (
  applicantId: string,
  categoryId: string,
  filename: string,
  tags: string[] = [],
): Promise<FileDto> => {
  let req = request(app)
    .post('/api/v1/platform/files')
    .set('Authorization', `Bearer ${adminToken}`)
    .field('moduleId', 'hr')
    .field('entityType', 'applicant')
    .field('entityId', applicantId)
    .field('categoryId', categoryId);
  // `tags` is ONE multipart field holding a JSON array, and `UploadFileFieldsSchema` is strict —
  // a repeated `tags[]` field is an unknown key and the upload comes back 400.
  if (tags.length > 0) req = req.field('tags', JSON.stringify(tags));
  const res = await req.attach('file', Buffer.from(`bytes-of-${filename}`), {
    filename,
    contentType: 'image/png',
  });
  expect(res.status, `upload ${filename}`).toBe(201);
  return data<FileDto>(res);
};

/**
 * Hand a document in AS THE CANDIDATE, which is the only way one gets into the folder.
 *
 * No staff key can do this — `hrApplicantDocumentFileAuthorizers` refuses every staff write — so
 * the portal account is not a convenience here, it is the only door.
 */
const handInDocument = async (
  applicant: ApplicantDto,
  nationalId: string,
  phone: string,
): Promise<string> => {
  const screening = mutated<ScreeningDto>(
    await request(app)
      .post('/api/v1/hr/screenings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantId: applicant.id }),
  );
  const decided = await request(app)
    .post(`/api/v1/hr/screenings/${screening.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'accepted', version: screening.version });
  expect(decided.status, 'accept screening').toBe(200);

  // The account is created and activated in two steps; a half-built one hands out a token that
  // fails on the next call, so wait for `active` exactly as the portal suite does.
  let account: UserDoc | null = null;
  for (let attempt = 0; attempt < 200 && account?.status !== 'active'; attempt += 1) {
    account = await userService.findByExternalSubject('hr', APPLICANT_PORTAL_SUBJECT, applicant.id);
    if (account?.status !== 'active') await new Promise((r) => setTimeout(r, 50));
  }
  expect(account?.status, 'portal account active').toBe('active');

  const spy = vi.spyOn(authService, 'generatePortalCode');
  await request(app)
    .post('/api/v1/auth/portal/challenge')
    .send({ subjectType: APPLICANT_PORTAL_SUBJECT, identifier: nationalId, phone });
  const issued = spy.mock.results.at(-1);
  spy.mockRestore();
  const otp = issued?.type === 'return' ? (issued.value as string) : '';
  const verified = await request(app)
    .post('/api/v1/auth/portal/verify')
    .send({ subjectType: APPLICANT_PORTAL_SUBJECT, identifier: nationalId, phone, code: otp });
  expect(verified.status, 'portal verify').toBe(200);
  const portalToken = data<{ accessToken: string }>(verified).accessToken;

  const types = await request(app)
    .get('/api/v1/hr/applicant-portal/documents')
    .set('Authorization', `Bearer ${portalToken}`);
  expect(types.status, 'portal documents').toBe(200);
  const slot = data<ApplicantDocumentSetDto>(types).missing[0];
  if (slot === undefined) throw new Error('no document slot is asked of this candidate');

  const uploaded = await request(app)
    .post('/api/v1/hr/applicant-portal/documents')
    .set('Authorization', `Bearer ${portalToken}`)
    .field('typeId', slot.typeId)
    .attach('file', Buffer.from('handed-in-bytes'), {
      filename: 'certificate.png',
      contentType: 'image/png',
    });
  expect(uploaded.status, 'hand in a document').toBe(201);
  // The portal upload answers `created(res, set)` — the set itself, with no workflow envelope
  // around it. It is the candidate's own write, not a stage transition.
  const set = data<ApplicantDocumentSetDto>(uploaded);
  const handed = set.documents[0];
  if (handed === undefined) throw new Error('the upload did not land in the set');
  return handed.fileId;
};

const folder = async (
  applicantId: string,
  token = adminToken,
): Promise<ApplicantFolderDetailDto> => {
  const res = await request(app)
    .get(`/api/v1/hr/applicant-documents/folders/${applicantId}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status, 'read folder').toBe(200);
  return data<ApplicantFolderDetailDto>(res);
};

const deleteFolder = (applicantId: string, token = adminToken): request.Test =>
  request(app)
    .delete(`/api/v1/hr/applicant-documents/folders/${applicantId}`)
    .set('Authorization', `Bearer ${token}`);

/**
 * The folders grid, as the screen reads it — rows AND the total.
 *
 * The total matters as much as the rows here: an emptied folder has to leave the count too, or the
 * pager promises a page that comes back with a hole in it.
 */
const listFolders = async (
  token = adminToken,
): Promise<{ rows: ApplicantFolderDto[]; total: number }> => {
  const res = await request(app)
    .get('/api/v1/hr/applicant-documents/folders')
    .query({ pageSize: 50 })
    .set('Authorization', `Bearer ${token}`);
  expect(res.status, 'list folders').toBe(200);
  return {
    rows: data<ApplicantFolderDto[]>(res),
    total: (res.body as { meta: { totalItems: number } }).meta.totalItems,
  };
};

const live = async (fileId: string): Promise<boolean> =>
  (await FileModel.countDocuments({ _id: new Types.ObjectId(fileId), isDeleted: false })) === 1;

// ── The world ─────────────────────────────────────────────────────────────

/** Emptied. Carries a card, an HR attachment and a handed-in document. */
let subject: ApplicantDto;
let subjectFiles: { card: FileDto; attachment: FileDto; handedIn: string };
/** The control: never named in any request, and must come out untouched. */
let bystander: ApplicantDto;
let bystanderFile: FileDto;
/** Hired. Their folder is a kept record. */
let hired: ApplicantDto;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const everything = [...platformPermissions, ...hrPermissions].map((p) => p.key);
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    everything,
  );
  const adminId = await account('folder-admin@ecms.local', String(superAdmin._id));
  // The refusal under test is a MISSING key, so this role is spelled out rather than derived: it
  // may read the folder and rule on documents, and that is all.
  const reader = await rbacService.createRole(
    {
      name: { en: 'Applicant documents reviewer', ar: 'مراجع مستندات المتقدمين' },
      permissionKeys: [
        'applicantDocument.view',
        'applicantDocument.review',
        'file.view',
        'file.download',
      ],
    },
    adminId,
  );
  await account('folder-reader@ecms.local', String(reader._id));
  // May empty a folder and may NOT touch an applicant — the pair the withdrawal's own refusal
  // turns on. `applicantDocument.delete` is not a licence to move somebody's application to a
  // terminal state, and this role is what proves the server agrees.
  const emptier = await rbacService.createRole(
    {
      name: { en: 'Applicant folder emptier', ar: 'مُفرِّغ مجلدات المتقدمين' },
      permissionKeys: [
        'applicantDocument.view',
        'applicantDocument.delete',
        'file.view',
        'file.download',
      ],
    },
    adminId,
  );
  await account('folder-emptier@ecms.local', String(emptier._id));

  const ctx: AuthContext = {
    userId: adminId,
    sessionId: 'seed',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  };
  await settingsService.set(ctx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });

  adminToken = await login('folder-admin@ecms.local');
  readerToken = await login('folder-reader@ecms.local');
  emptierToken = await login('folder-emptier@ecms.local');

  const general = await fileCategoryService.ensure({
    key: 'folder-delete-spec-general',
    name: { ar: 'مستندات عامة', en: 'General documents' },
    allowedMimeTypes: ['image/png'],
    maxSizeMb: 5,
    retentionDays: null,
  });
  generalCategoryId = String(general._id);
  const cardCategoryId = await resolveNationalIdCardCategoryId();

  subject = await registerApplicant('29001011590011', '01099880011');
  bystander = await registerApplicant('29001011590022', '01099880022');
  hired = await registerApplicant('29001011590033', '01099880033');

  subjectFiles = {
    card: await attach(subject.id, cardCategoryId, 'card-front.png', ['nid:front']),
    attachment: await attach(subject.id, generalCategoryId, 'cv.png'),
    handedIn: await handInDocument(subject, '29001011590011', '01099880011'),
  };
  bystanderFile = await attach(bystander.id, generalCategoryId, 'other-cv.png');

  // The guard reads `status`; this is the field the workflow's `hire` transition writes.
  await ApplicantModel.updateOne({ _id: hired.id }, { $set: { status: 'hired' } }).exec();
}, 300_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the folder says, before anybody tries, whether it may be emptied', () => {
  it('reports no block for an ordinary candidate', async () => {
    expect((await folder(subject.id)).deleteBlock).toBeNull();
  });

  it('reports `hired` for a candidate who was hired', async () => {
    expect((await folder(hired.id)).deleteBlock).toBe<ApplicantFolderDeleteBlock>('hired');
  });

  it('carries the same answer on the LIST, so a disabled button can explain itself', async () => {
    const res = await request(app)
      .get('/api/v1/hr/applicant-documents/folders')
      .query({ pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = data<ApplicantFolderDto[]>(res);
    expect(rows.find((row) => row.applicantId === hired.id)?.deleteBlock).toBe('hired');
    expect(rows.find((row) => row.applicantId === subject.id)?.deleteBlock).toBeNull();
  });
});

describe('the key is checked on the server, not on the screen', () => {
  it('refuses a reviewer who holds view and review but not delete', async () => {
    const res = await deleteFolder(subject.id, readerToken);
    expect(res.status).toBe(403);
    // And nothing moved.
    expect(await live(subjectFiles.attachment.id)).toBe(true);
  });

  it('refuses an unauthenticated caller outright', async () => {
    const res = await request(app).delete(`/api/v1/hr/applicant-documents/folders/${subject.id}`);
    expect(res.status).toBe(401);
  });
});

describe('a kept record is refused, and says which rule refused it', () => {
  it('refuses a HIRED applicant with its own error code', async () => {
    const res = await deleteFolder(hired.id);
    expect(res.status).toBe(422);
    expect(code(res)).toBe(ErrorCodes.APPLICANT_FOLDER_KEPT_RECORD);
  });

  /**
   * The clause that matters most, and the one a status check would miss.
   *
   * `employeeService.nationalIdCard` copies the card out of the applicant's folder the first time
   * anybody opens an employee's card and finds none of their own — for as long as the person works
   * here. The row below carries only the two fields the guard reads; it is a fixture for that
   * query, not a realistic employee.
   */
  it('refuses an applicant an employee record was created from, even with status `new`', async () => {
    const employed = await registerApplicant('29001011590044', '01099880044');
    await EmployeeModel.collection.insertOne({
      applicantId: new Types.ObjectId(employed.id),
      isDeleted: false,
    });
    expect((await folder(employed.id)).deleteBlock).toBe<ApplicantFolderDeleteBlock>('employed');
    const res = await deleteFolder(employed.id);
    expect(res.status).toBe(422);
    expect(code(res)).toBe(ErrorCodes.APPLICANT_FOLDER_KEPT_RECORD);
  });

  it('refuses an applicant holding an accepted offer — the window before the employee exists', async () => {
    const offered = await registerApplicant('29001011590055', '01099880055');
    await JobOfferModel.collection.insertOne({
      applicantId: new Types.ObjectId(offered.id),
      status: 'accepted',
      supersededAt: null,
      isDeleted: false,
    });
    expect((await folder(offered.id)).deleteBlock).toBe<ApplicantFolderDeleteBlock>(
      'acceptedOffer',
    );
    expect((await deleteFolder(offered.id)).status).toBe(422);
  });
});

describe('emptying one folder', () => {
  it('removes every file it showed, and only that applicant’s', async () => {
    const before = await folder(subject.id);
    expect(before.files.length).toBe(3);

    const res = await deleteFolder(subject.id);
    expect(res.status).toBe(200);
    const result = data<DeletedApplicantFolderDto>(res);
    expect(result.applicantId).toBe(subject.id);
    expect(result.filesRemoved).toBe(3);

    expect(await live(subjectFiles.card.id)).toBe(false);
    expect(await live(subjectFiles.attachment.id)).toBe(false);
    expect(await live(subjectFiles.handedIn)).toBe(false);
    // The control, never named in the request.
    expect(await live(bystanderFile.id)).toBe(true);
    expect((await folder(bystander.id)).files.length).toBe(1);
  });

  /**
   * The SHELF is gone, the PERSON is not.
   *
   * An emptied folder sitting in the grid as a nought-file tile is the thing this behaviour exists
   * to prevent: HR removed what was there, so there is nothing left to show. What must survive is
   * everything else — the applicant's record, their code, their history — and the folder itself
   * still answers when asked for by name, which is what keeps a link to it from breaking.
   */
  it('drops out of the folders grid, while the applicant record stays', async () => {
    const { rows } = await listFolders();
    expect(rows.find((row) => row.applicantId === subject.id)).toBeUndefined();
    expect(
      await ApplicantModel.countDocuments({
        _id: new Types.ObjectId(subject.id),
        isDeleted: false,
      }),
    ).toBe(1);
    const after = await folder(subject.id);
    expect(after.files).toEqual([]);
    expect(after.fileCount).toBe(0);
    expect(after.applicantCode).toBe(subject.code);
  });

  /** The pointers went with the bytes; otherwise the candidate's slot would be bricked. */
  it('drops the handed-in documents set, so the slot is free again', async () => {
    expect(
      await ApplicantDocumentSetModel.countDocuments({
        applicantId: new Types.ObjectId(subject.id),
        isDeleted: false,
      }),
    ).toBe(0);
  });

  it('zeroes the attachment counter on the applicant’s own record', async () => {
    const row = await ApplicantModel.findById(subject.id).lean<{ attachmentCount: number }>();
    expect(row?.attachmentCount).toBe(0);
  });

  it('soft-deletes, never destroys — the rows and their bytes are still recoverable', async () => {
    const row = await FileModel.findOne({ _id: new Types.ObjectId(subjectFiles.card.id) })
      .lean<{ isDeleted: boolean; deletedAt: Date | null; storage: { key: string } }>()
      .exec();
    expect(row?.isDeleted).toBe(true);
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.storage.key).toBeTruthy();
  });

  it('writes one audit row for the act, naming the applicant and the count', async () => {
    await waitFor(
      async () =>
        (await AuditLogModel.countDocuments({
          action: 'applicantFolderDeleted',
          'entityRef.entityId': subject.id,
        })) > 0,
    );
    const row = await AuditLogModel.findOne({
      action: 'applicantFolderDeleted',
      'entityRef.entityId': subject.id,
    })
      .lean<{
        entityRef: { moduleId: string; entityType: string };
        actor: { userId: string | null };
        changes: { field: string; old: unknown; new: unknown }[];
      }>()
      .exec();
    expect(row?.entityRef).toMatchObject({ moduleId: 'hr', entityType: 'applicant' });
    expect(row?.actor.userId).toBeTruthy();
    expect(row?.changes.find((c) => c.field === 'filesRemoved')?.new).toBe(3);
    expect(row?.changes.find((c) => c.field === 'applicantCode')?.new).toBe(subject.code);
  });

  it('is safe to repeat — an already-empty folder is not an error', async () => {
    const again = await deleteFolder(subject.id);
    expect(again.status).toBe(200);
    expect(data<DeletedApplicantFolderDto>(again).filesRemoved).toBe(0);
  });
});

describe('emptying several at once', () => {
  it('empties what it may and names what it kept, in one answer', async () => {
    const first = await registerApplicant('29001011590066', '01099880066');
    const second = await registerApplicant('29001011590077', '01099880077');
    const firstFile = await attach(first.id, generalCategoryId, 'first.png');
    const secondFile = await attach(second.id, generalCategoryId, 'second.png');

    const res = await request(app)
      .post('/api/v1/hr/applicant-documents/folders/bulk-delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantIds: [first.id, hired.id, second.id] });
    expect(res.status).toBe(200);
    const result = data<DeleteApplicantFoldersResultDto>(res);

    expect(result.deleted.map((row) => row.applicantId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0]?.applicantId).toBe(hired.id);
    expect(result.refused[0]?.reason).toBe<ApplicantFolderDeleteBlock>('hired');

    expect(await live(firstFile.id)).toBe(false);
    expect(await live(secondFile.id)).toBe(false);
    // The hired candidate's folder was not touched at all.
    expect((await folder(hired.id)).fileCount).toBe(0);
  });

  it('needs the delete key for the bulk route too', async () => {
    const res = await request(app)
      .post('/api/v1/hr/applicant-documents/folders/bulk-delete')
      .set('Authorization', `Bearer ${readerToken}`)
      .send({ applicantIds: [bystander.id] });
    expect(res.status).toBe(403);
    expect(await live(bystanderFile.id)).toBe(true);
  });

  /**
   * 400 and not 422: both of these are SCHEMA violations, caught by `BulkDeleteApplicantFoldersSchema`
   * at the route edge before any rule of the feature's own runs. 422 is this codebase's status for a
   * business rule that refused — «this folder is a kept record» — which is a different answer to a
   * different question.
   */
  it('refuses an empty selection and one past the cap', async () => {
    const empty = await request(app)
      .post('/api/v1/hr/applicant-documents/folders/bulk-delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantIds: [] });
    expect(empty.status).toBe(400);
    const tooMany = await request(app)
      .post('/api/v1/hr/applicant-documents/folders/bulk-delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantIds: Array.from({ length: 51 }, () => new Types.ObjectId().toString()) });
    expect(tooMany.status).toBe(400);
  });
});

describe('the handed-in document’s type reaches the folder', () => {
  it('names each portal upload by the catalogue type it was handed in for', async () => {
    const applicant = await registerApplicant('29001011590088', '01099880088');
    await handInDocument(applicant, '29001011590088', '01099880088');
    const types = await request(app)
      .get('/api/v1/hr/applicant-documents/types')
      .query({ pageSize: 50, active: true })
      .set('Authorization', `Bearer ${adminToken}`);
    const catalogue = data<ApplicantDocumentTypeDto[]>(types);

    const open = await folder(applicant.id);
    const handed = open.files.find((f) => f.kind === 'document');
    // `toBeDefined` first, deliberately: `undefined` sails straight through `not.toBeNull()`, so a
    // folder that showed no handed-in document at all would have passed this test while proving
    // the opposite of what it claims. That is exactly what happened before `filesOf` passed the
    // caller to the Files service.
    expect(handed).toBeDefined();
    expect(handed?.documentType).not.toBeNull();
    expect(catalogue.map((row) => row.name.ar)).toContain(handed?.documentType?.ar);
    // Nothing else claims a type.
    for (const file of open.files.filter((f) => f.kind !== 'document')) {
      expect(file.documentType).toBeNull();
    }
  });
});

/**
 * The grid's rule, end to end: a folder HR emptied is gone, and it comes back if anything is
 * filed for that person again.
 *
 * Self-contained on purpose — its own applicant, its own files — because it both reads and WRITES
 * the folder it is about, and sharing `subject` would make every test after it depend on the order
 * this one happened to run in.
 */
describe('an emptied folder leaves the grid, and returns with the next document', () => {
  it('is on the grid while it holds something, gone once emptied, back when refilled', async () => {
    const person = await registerApplicant('29001011590166', '01099880166');
    const first = await attach(person.id, generalCategoryId, 'before.png');

    const before = await listFolders();
    expect(before.rows.find((row) => row.applicantId === person.id)?.fileCount).toBe(1);

    expect((await deleteFolder(person.id)).status).toBe(200);

    const emptied = await listFolders();
    expect(emptied.rows.find((row) => row.applicantId === person.id)).toBeUndefined();
    // The count went with the row. A total that still included it would promise a page with a
    // hole in it.
    expect(emptied.total).toBe(before.total - 1);
    expect(await live(first.id)).toBe(false);

    // Nothing is reset to bring it back: the marker only nominates a folder for hiding and the
    // FILES settle it, so filing anything new is enough.
    const second = await attach(person.id, generalCategoryId, 'after.png');
    const refilled = await listFolders();
    expect(refilled.rows.find((row) => row.applicantId === person.id)?.fileCount).toBe(1);
    expect(refilled.total).toBe(before.total);
    expect(await live(second.id)).toBe(true);
    // And the file that was removed stays removed — coming back is not undoing.
    expect(await live(first.id)).toBe(false);
  });
});

/**
 * Withdrawing the application along with the folder.
 *
 * The lifecycle move itself is the applicants module's, with its own key, its own audit row and
 * its own event. What is pinned here is that this route reaches it rather than reimplementing it,
 * that it needs the applicants module's key, and that a folder it REFUSED to empty is never
 * withdrawn — that last one is the dangerous case: a refusal means this person was hired or is
 * being hired, and withdrawing them would be the opposite of true.
 */
describe('withdrawing the application with the folder', () => {
  const REASON = 'انسحب المتقدم من التقديم';

  const statusOf = async (applicantId: string): Promise<string> => {
    const row = await ApplicantModel.findById(applicantId)
      .lean<{ status: string; withdrawnReason: string | null }>()
      .exec();
    return row?.status ?? '';
  };

  it('moves the application to withdrawn, with the reason on the record', async () => {
    const person = await registerApplicant('29001011590099', '01099880099');
    const theirFile = await attach(person.id, generalCategoryId, 'withdraw-me.png');

    const res = await deleteFolder(person.id).send({ withdraw: true, withdrawReason: REASON });
    expect(res.status).toBe(200);
    const result = data<DeletedApplicantFolderDto>(res);
    expect(result.filesRemoved).toBe(1);
    expect(result.withdrawn).toBe(true);

    expect(await statusOf(person.id)).toBe('withdrawn');
    const row = await ApplicantModel.findById(person.id)
      .lean<{ withdrawnReason: string | null; withdrawnAt: Date | null }>()
      .exec();
    expect(row?.withdrawnReason).toBe(REASON);
    expect(row?.withdrawnAt).not.toBeNull();
    expect(await live(theirFile.id)).toBe(false);
  });

  /** The applicants module's own audit row, not a second one invented here. */
  it('leaves the lifecycle’s own audit trail behind it', async () => {
    const person = await registerApplicant('29001011590111', '01099880111');
    await attach(person.id, generalCategoryId, 'audit-me.png');
    expect(
      (await deleteFolder(person.id).send({ withdraw: true, withdrawReason: REASON })).status,
    ).toBe(200);

    await waitFor(
      async () =>
        (await AuditLogModel.countDocuments({
          action: 'statusChange',
          'entityRef.entityId': person.id,
        })) > 0,
    );
    const row = await AuditLogModel.findOne({
      action: 'statusChange',
      'entityRef.entityId': person.id,
    })
      .lean<{ changes: { field: string; new: unknown }[] }>()
      .exec();
    expect(row?.changes.find((c) => c.field === 'status')?.new).toBe('withdrawn');
  });

  it('leaves the application alone when nobody asked', async () => {
    const person = await registerApplicant('29001011590122', '01099880122');
    await attach(person.id, generalCategoryId, 'keep-status.png');

    const res = await deleteFolder(person.id);
    expect(res.status).toBe(200);
    expect(data<DeletedApplicantFolderDto>(res).withdrawn).toBe(false);
    expect(await statusOf(person.id)).not.toBe('withdrawn');
  });

  /**
   * Refused WHOLE, files included. Emptying the folder and quietly skipping the withdrawal would
   * answer «delete and withdraw» with «deleted» and give the caller no way to notice.
   */
  it('refuses a caller holding the folder key but not applicant.edit, and deletes nothing', async () => {
    const person = await registerApplicant('29001011590133', '01099880133');
    const theirFile = await attach(person.id, generalCategoryId, 'not-yours.png');

    const res = await deleteFolder(person.id, emptierToken).send({
      withdraw: true,
      withdrawReason: REASON,
    });
    expect(res.status).toBe(403);
    expect(await live(theirFile.id)).toBe(true);
    expect(await statusOf(person.id)).not.toBe('withdrawn');
  });

  /** The same caller may still do the thing their key IS for. */
  it('lets that caller empty the folder when they do not ask for a withdrawal', async () => {
    const person = await registerApplicant('29001011590144', '01099880144');
    const theirFile = await attach(person.id, generalCategoryId, 'mine-to-empty.png');

    expect((await deleteFolder(person.id, emptierToken)).status).toBe(200);
    expect(await live(theirFile.id)).toBe(false);
  });

  it('will not withdraw without a reason to put on the record', async () => {
    const person = await registerApplicant('29001011590155', '01099880155');
    const theirFile = await attach(person.id, generalCategoryId, 'no-reason.png');

    const res = await deleteFolder(person.id).send({ withdraw: true });
    expect(res.status).toBe(400);
    expect(await live(theirFile.id)).toBe(true);
  });

  it('never withdraws an applicant whose folder it kept', async () => {
    const res = await request(app)
      .post('/api/v1/hr/applicant-documents/folders/bulk-delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantIds: [hired.id], withdraw: true, withdrawReason: REASON });

    expect(res.status).toBe(200);
    const result = data<DeleteApplicantFoldersResultDto>(res);
    expect(result.deleted).toEqual([]);
    expect(result.refused.map((row) => row.reason)).toEqual(['hired']);
    expect(await statusOf(hired.id)).toBe('hired');
  });
});

/**
 * The folder is listed as the CALLER, asking the question of the ACT — and this is the case that
 * made it matter.
 *
 * What the candidate hands in through the portal is filed under `applicantDocuments`, which carries
 * an ADR-023 authorizer, and that authorizer grants READING to the reviewer's key and REMOVING to
 * the delete key. So the folder listing has to be taken with the caller and with the delete intent:
 *   · taken anonymously, the Files service drops every guarded row and the folder shows the card
 *     and HR's attachments while silently omitting every document the candidate submitted;
 *   · taken with a READ question, an emptier who holds `applicantDocument.delete` and not the
 *     reviewer's key gets the same empty answer.
 * Either way the delete would drop the set rows that point at those documents and then leave the
 * documents themselves live and orphaned — reporting success the whole time.
 *
 * `folder-emptier@ecms.local` holds the delete key and NOT `.review`, which is exactly the caller
 * that would have been fooled.
 */
describe('emptying a folder reaches what the candidate handed in', () => {
  it('removes the handed-in document for a caller holding delete but not review', async () => {
    const person = await registerApplicant('29001011590177', '01099880177');
    const handedIn = await handInDocument(person, '29001011590177', '01099880177');
    expect(await live(handedIn), 'the document is on file to begin with').toBe(true);

    // It is IN the folder — the assertion that fails if the listing goes back to being anonymous.
    const open = await folder(person.id);
    expect(open.files.some((f) => f.kind === 'document')).toBe(true);

    const res = await deleteFolder(person.id, emptierToken);
    expect(res.status).toBe(200);
    expect(data<DeletedApplicantFolderDto>(res).filesRemoved).toBeGreaterThan(0);

    // The document went with the rest. A folder reported as emptied that still held the
    // candidate's certificate is the silent failure this whole arrangement exists to prevent.
    expect(await live(handedIn), 'the document after the delete').toBe(false);
    expect(
      await ApplicantDocumentSetModel.countDocuments({
        applicantId: new Types.ObjectId(person.id),
        isDeleted: false,
      }),
    ).toBe(0);
  });
});
