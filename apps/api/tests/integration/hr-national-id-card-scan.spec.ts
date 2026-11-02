// Reading a National-ID card costs the registration's own permission, and no file permission.
//
// THE BUG THIS PINS. An HR user on the live site could not read a card: every attempt answered «لا
// توجد فئة ملفات للصور مُهيّأة» — «no image file category is configured» — while the admin account
// worked. Nothing was misconfigured. The screen found the National-ID category by listing
// `/platform/file-categories` (needs `file.view`), uploaded through `POST /platform/files` (needs
// `file.create`), and the reader pulled the bytes back under the generic download rule (needs
// `file.download`). An HR role holds none of the three, and `file.view` must not be granted to fix
// it: it lists files across the whole system, ID cards included.
//
// Only a running server can answer whether that is true now, because the claim is about the
// permission registry, the route guard, the ADR-023 authorizer and the Files service agreeing —
// four things no unit test holds at once. So the role here is spelled out rather than derived: it
// may create an applicant, and that is all it may do.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { fileService } from '../../src/platform/files';
import { FileModel } from '../../src/platform/files/file.model';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { resolveNationalIdCardCategoryId } from '../../src/modules/hr/recruitment/applicants/national-id-card.files';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { APPLICANT_CARD_SCAN_ENTITY_TYPE } from '../../src/modules/hr/recruitment/applicants/national-id-scan.files';

const PASSWORD = 'Str0ng#Pass!';
const UPLOAD = '/api/v1/hr/applicants/national-id-card/upload';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
/** Holds `applicant.create` and NOT one `file.*` — the whole point. */
let registrarToken: string;
let registrarId: string;
/** Holds `applicant.view` only: may see applicants, may not register one. */
let onlookerToken: string;

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const code = (res: request.Response): string =>
  (res.body as { error?: { code?: string } }).error?.code ?? '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-national-id-scan-${String(Date.now())}`;
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

/** Post one file to the HR card-scan route. */
const upload = (
  token: string,
  filename: string,
  contentType: string,
  bytes = 'card-image-bytes',
): request.Test =>
  request(app)
    .post(UPLOAD)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.from(bytes), { filename, contentType });

/** The caller as the OCR reader sees them: one permission, nothing else. */
const contextOf = (userId: string, permissions: Record<string, string>): AuthContext =>
  ({
    userId,
    sessionId: 'scan-spec',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'en',
    permissions,
    permissionVersion: 1,
    isPrivileged: false,
  }) as unknown as AuthContext;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const registrar = await rbacService.createRole(
    {
      name: { en: 'Applicant registrar', ar: 'مُسجِّل المتقدمين' },
      // Deliberately exhaustive: adding `file.view` here would make every assertion below pass for
      // the wrong reason, which is exactly the fix this spec is checking did not happen.
      permissionKeys: ['applicant.create'],
    },
    String(new Types.ObjectId()),
  );
  registrarId = await account('card-registrar@ecms.local', String(registrar._id));

  const onlooker = await rbacService.createRole(
    { name: { en: 'Applicant onlooker', ar: 'مُطالِع المتقدمين' }, permissionKeys: ['applicant.view'] },
    registrarId,
  );
  await account('card-onlooker@ecms.local', String(onlooker._id));

  // No TOTP dance: neither role here is privileged, so the enforcement setting cannot reach them.
  registrarToken = await login('card-registrar@ecms.local');
  onlookerToken = await login('card-onlooker@ecms.local');
}, 300_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('an HR user with only the registration key can read a card', () => {
  it('files the image and hands back its id', async () => {
    const res = await upload(registrarToken, 'card-front.png', 'image/png');
    expect(res.status).toBe(201);
    expect(data<{ fileId: string }>(res).fileId).toMatch(/^[0-9a-f]{24}$/);
  });

  /**
   * THE CATEGORY IS THE SERVER'S BUSINESS NOW. The browser never names one, and the route resolves
   * — and ensures — the National-ID category itself, so a database seeded before that category
   * existed gets it created on first use instead of failing.
   */
  it('files it in the National-ID category without being told which one', async () => {
    const { fileId } = data<{ fileId: string }>(await upload(registrarToken, 'back.jpg', 'image/jpeg'));
    const row = await FileModel.findById(fileId)
      .lean<{ entityRef: { entityType: string }; categoryId: unknown }>()
      .exec();
    expect(row?.entityRef.entityType).toBe(APPLICANT_CARD_SCAN_ENTITY_TYPE);
    // Against the id the server resolves, not a populated key: the same call the route makes, so
    // the two cannot drift apart without this failing.
    expect(String(row?.categoryId)).toBe(await resolveNationalIdCardCategoryId());
  });

  /**
   * And the bytes come BACK, which is the half the old arrangement failed on even once the upload
   * was fixed: the reader used the generic download rule, so a role without `file.download` could
   * file a card it could never have read. `readEntityOwnedBuffer` asks this module's authorizer
   * instead, and it answers with the registration's own key.
   */
  it('reads the bytes back with no file permission at all', async () => {
    const { fileId } = data<{ fileId: string }>(
      await upload(registrarToken, 'readable.png', 'image/png', 'the-card-bytes'),
    );
    const ctx = contextOf(registrarId, { 'applicant.create': 'organization' });

    const { buffer } = await fileService.readEntityOwnedBuffer(ctx, fileId);

    expect(buffer.toString()).toBe('the-card-bytes');
  });
});

describe('and nobody else can', () => {
  it('refuses a caller who may see applicants but not register one', async () => {
    const res = await upload(onlookerToken, 'card-front.png', 'image/png');
    expect(res.status).toBe(403);
  });

  it('refuses an unauthenticated caller outright', async () => {
    const res = await request(app)
      .post(UPLOAD)
      .attach('file', Buffer.from('bytes'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });

  /** The same key, asked of the bytes rather than of the route. */
  it('refuses the byte read to a caller without the registration key', async () => {
    const { fileId } = data<{ fileId: string }>(await upload(registrarToken, 'guarded.png', 'image/png'));
    await expect(
      fileService.readEntityOwnedBuffer(
        contextOf(registrarId, { 'applicant.view': 'organization' }),
        fileId,
      ),
    ).rejects.toThrow();
  });
});

describe('what may be filed as a card', () => {
  /**
   * Image only, and checked at the edge rather than left to the category: the National-ID category
   * also allows a PDF, which is right for a scan filed by hand and wrong for this route — what
   * arrives here came from a camera, and the reader can do nothing with a PDF. Refusing it here
   * keeps the error about the file instead of about the read.
   */
  it.each([
    ['a PDF', 'scan.pdf', 'application/pdf'],
    ['a text file', 'notes.txt', 'text/plain'],
  ])('refuses %s', async (_label, filename, contentType) => {
    const res = await upload(registrarToken, filename, contentType);
    expect(res.status).toBe(400);
    expect(code(res)).toBe('VALIDATION_FAILED');
  });

  it('accepts the image types a phone camera produces', async () => {
    for (const [filename, contentType] of [
      ['shot.jpg', 'image/jpeg'],
      ['shot.png', 'image/png'],
      ['shot.webp', 'image/webp'],
    ]) {
      const res = await upload(registrarToken, filename ?? '', contentType ?? '');
      expect(res.status, contentType).toBe(201);
    }
  });
});
