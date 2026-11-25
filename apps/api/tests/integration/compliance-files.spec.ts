// Compliance and Risks — the files page over real HTTP, real RBAC and a real database
// (docs/12-planning/compliance-files-design.md §12).
//
// What a mocked spec cannot see: a folder shown to the people on its list and to nobody else, a
// person outside it answered 404 as if it did not exist; the reader's key given by the module with
// the first folder shared and taken back with the last; only PDF, Word and Excel kept, by name AND
// by content, under the 20 MB limit; a reader who may open and download and do nothing else; every
// opening and download counted, and the responsible person's report of who has seen what, when.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SettingKeys,
  platformPermissions,
  type ComplianceDocumentDto,
  type ComplianceFolderDto,
  type CompliancePersonDto,
  type CompliancePreviewDto,
  type ComplianceSeenReportDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { compliancePermissions } from '../../src/modules/compliance/compliance.module';
import { COMPLIANCE_READER_ROLE } from '../../src/modules/compliance/compliance-roles';
import { rbacService } from '../../src/platform/rbac';
import { RoleModel } from '../../src/platform/rbac/role.model';
import { RoleAssignmentModel } from '../../src/platform/rbac/role-assignment.model';
import { userService } from '../../src/platform/users';
import { UserModel } from '../../src/platform/users/user.model';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

const resolveMongoUri = async (): Promise<string> => {
  const dbName = `ecms-compliance-test-${Date.now()}`;
  const external = process.env.MONGO_TEST_URI;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const code = (res: request.Response): string =>
  (res.body as { error?: { code: string } }).error?.code ?? '';

/** A person: an account (an employee's login unless `employee` is false), signed in. */
interface Person {
  id: string;
  email: string;
  token: string;
}

let adminId = '';
const mkUser = async (email: string, employee: boolean): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'موظف', en: 'Staff' },
      lastName: { ar: email.split('@')[0] ?? 'x', en: email.split('@')[0] ?? 'x' },
      locale: 'ar',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(user._id));
  // An employee's login: HR links it to its employee record. The record itself is HR's business;
  // all the module asks is that the account is one.
  if (employee) {
    await UserModel.updateOne({ _id: user._id }, { $set: { employeeId: new Types.ObjectId() } });
  }
  return String(user._id);
};

const login = async (email: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const person = async (who: string, keys: string[] = [], employee = true): Promise<Person> => {
  const email = `compliance-${who}@ecms.local`;
  const id = await mkUser(email, employee);
  if (keys.length > 0) {
    const role = await rbacService.createRole(
      { name: { en: `Compliance ${who}`, ar: `الالتزام ${who}` }, permissionKeys: keys },
      adminId,
    );
    await rbacService.ensureAssignment(id, String(role._id), 'organization');
  }
  return { id, email, token: await login(email) };
};

/** Sign in again — a grant changed under the last session. */
const refresh = async (who: Person): Promise<Person> => ({ ...who, token: await login(who.email) });

const api = (who: Person) => {
  const as = (req: request.Test): request.Test => req.set('Authorization', `Bearer ${who.token}`);
  const base = '/api/v1/compliance';
  return {
    get: (path: string) => as(request(app).get(`${base}${path}`)),
    post: (path: string, body: Record<string, unknown>) =>
      as(request(app).post(`${base}${path}`)).send(body),
    patch: (path: string, body: Record<string, unknown>) =>
      as(request(app).patch(`${base}${path}`)).send(body),
    delete: (path: string) => as(request(app).delete(`${base}${path}`)),
    upload: (
      path: string,
      file: { buffer: Buffer; filename: string; contentType: string },
      fields: Record<string, string> = {},
    ) => {
      let req = as(request(app).post(`${base}${path}`));
      for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
      return req.attach('file', file.buffer, {
        filename: file.filename,
        contentType: file.contentType,
      });
    },
    platform: (path: string) => as(request(app).get(`/api/v1/platform${path}`)),
  };
};

// ── Files a person would really upload ─────────────────────────────────────

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const docx = async (): Promise<Buffer> => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="w"><w:body>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>سياسة مكافحة غسل الأموال</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">يلتزم كل موظف </w:t></w:r><w:r><w:t>بالإبلاغ.</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>البند</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>الحد</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>نقدي</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>100000</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '</w:body></w:document>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
};

const xlsx = async (): Promise<Buffer> => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file(
    'xl/workbook.xml',
    '<workbook xmlns:r="r"><sheets><sheet name="المخاطر" sheetId="1" r:id="rId1"/>' +
      '<sheet name="مخفي" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
  );
  zip.file(
    'xl/sharedStrings.xml',
    '<sst><si><t>الخطر</t></si><si><t>الدرجة</t></si><si><t>احتيال</t></si></sst>',
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>4.5</v></c></row></sheetData></worksheet>',
  );
  zip.file('xl/worksheets/sheet2.xml', '<worksheet><sheetData/></worksheet>');
  return zip.generateAsync({ type: 'nodebuffer' });
};

const PDF_TYPE = 'application/pdf';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ── The world ───────────────────────────────────────────────────────────────

let manager: Person;
let readerA: Person;
let readerB: Person;
let stranger: Person;
let customer: Person;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...compliancePermissions].map((p) => p.key),
  );
  adminId = await mkUser('compliance-admin@ecms.local', false);
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
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

  manager = await person('manager', ['complianceFile.manage', 'complianceFile.view']);
  readerA = await person('reader-a');
  readerB = await person('reader-b');
  stranger = await person('stranger', ['complianceFile.view']);
  customer = await person('customer', [], false);
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

const readerRoleHeldBy = async (userId: string): Promise<boolean> => {
  const role = await RoleModel.findOne({ key: COMPLIANCE_READER_ROLE.key }).lean().exec();
  if (role === null) return false;
  return (
    (await RoleAssignmentModel.exists({
      userId: new Types.ObjectId(userId),
      roleId: role._id,
      scope: 'own',
      isDeleted: false,
    }).exec()) !== null
  );
};

let folder: ComplianceFolderDto;

describe('the seed', () => {
  it('seeds the responsible person’s role and the reader’s', async () => {
    const roles = await RoleModel.find({
      key: { $in: ['compliance-files-manager', 'compliance-files-reader'] },
    })
      .lean()
      .exec();
    expect(roles.map((role) => [role.key, [...role.permissionKeys].sort()]).sort()).toEqual([
      ['compliance-files-manager', ['complianceFile.manage', 'complianceFile.view']],
      ['compliance-files-reader', ['complianceFile.view']],
    ]);
  });
});

describe('folders', () => {
  it('are made by the responsible person, shared with the people named', async () => {
    const res = await api(manager).post('/folders', {
      name: 'سياسات مكافحة غسل الأموال',
      viewerUserIds: [readerA.id],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    folder = data<ComplianceFolderDto>(res);
    expect(folder.viewers.map((v) => v.userId)).toEqual([readerA.id]);
    expect(folder.documentCount).toBe(0);
    expect(folder.hasCover).toBe(false);
  });

  it('give the reader the page key with the first folder shared', async () => {
    expect(await readerRoleHeldBy(readerA.id)).toBe(true);
    expect(await readerRoleHeldBy(readerB.id)).toBe(false);
    readerA = await refresh(readerA);
    const res = await api(readerA).get('/folders');
    expect(res.status).toBe(200);
    const shelf = data<ComplianceFolderDto[]>(res);
    expect(shelf.map((f) => f.id)).toEqual([folder.id]);
    // A reader is told the folder is theirs, never who else has it.
    expect(shelf[0]?.viewers).toEqual([]);
  });

  it('are invisible to a person not on the list — even one who holds the page key', async () => {
    expect(data<ComplianceFolderDto[]>(await api(stranger).get('/folders'))).toEqual([]);
    expect((await api(stranger).get(`/folders/${folder.id}`)).status).toBe(404);
    expect((await api(stranger).get(`/folders/${folder.id}/documents`)).status).toBe(404);
    // No key at all: the page is not theirs.
    expect((await api(readerB).get('/folders')).status).toBe(403);
  });

  it('refuse a second folder of the same name, spelled differently', async () => {
    const res = await api(manager).post('/folders', { name: 'سياسات  مكافحة غسل الاموال' });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('COMPLIANCE_FOLDER_NAME_TAKEN');
  });

  it('are shared only with active employee accounts', async () => {
    const res = await api(manager).patch(`/folders/${folder.id}`, {
      viewerUserIds: [readerA.id, customer.id],
      version: folder.version,
    });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('COMPLIANCE_VIEWER_INVALID');
  });

  it('may be renamed and shared further, under the version seen', async () => {
    const stale = await api(manager).patch(`/folders/${folder.id}`, {
      name: 'x',
      version: folder.version + 5,
    });
    expect(stale.status).toBe(409);
    const res = await api(manager).patch(`/folders/${folder.id}`, {
      name: 'سياسات غسل الأموال',
      viewerUserIds: [readerA.id, readerB.id],
      version: folder.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    folder = data<ComplianceFolderDto>(res);
    expect(folder.name).toBe('سياسات غسل الأموال');
    expect(folder.viewers.map((v) => v.userId).sort()).toEqual([readerA.id, readerB.id].sort());
    expect(await readerRoleHeldBy(readerB.id)).toBe(true);
    readerB = await refresh(readerB);
  });

  it('cannot be written by a reader', async () => {
    expect((await api(readerA).post('/folders', { name: 'خاص' })).status).toBe(403);
    expect(
      (await api(readerA).patch(`/folders/${folder.id}`, { name: 'ب', version: folder.version }))
        .status,
    ).toBe(403);
    expect(
      (await api(readerA).delete(`/folders/${folder.id}?version=${folder.version}`)).status,
    ).toBe(403);
    expect((await api(readerA).get('/people')).status).toBe(403);
  });

  it('wear a picture the responsible person puts on, which every reader sees', async () => {
    const res = await api(manager).upload(
      `/folders/${folder.id}/cover`,
      { buffer: PNG, filename: 'cover.png', contentType: 'image/png' },
      { version: String(folder.version) },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    folder = data<ComplianceFolderDto>(res);
    expect(folder.hasCover).toBe(true);
    const cover = await api(readerA).get(`/folders/${folder.id}/cover`);
    expect(cover.status).toBe(200);
    expect(cover.headers['content-type']).toContain('image/png');
    expect((await api(stranger).get(`/folders/${folder.id}/cover`)).status).toBe(404);

    const notAPicture = await api(manager).upload(
      `/folders/${folder.id}/cover`,
      { buffer: PDF, filename: 'cover.png', contentType: 'image/png' },
      { version: String(folder.version) },
    );
    expect(notAPicture.status).toBe(422);
  });
});

let pdfDoc: ComplianceDocumentDto;
let wordDoc: ComplianceDocumentDto;

describe('files', () => {
  it('take PDF, Word and Excel', async () => {
    const pdf = await api(manager).upload(`/folders/${folder.id}/documents`, {
      buffer: PDF,
      filename: 'دليل الالتزام.pdf',
      contentType: PDF_TYPE,
    });
    expect(pdf.status, JSON.stringify(pdf.body)).toBe(201);
    pdfDoc = data<ComplianceDocumentDto>(pdf);
    expect(pdfDoc.name).toBe('دليل الالتزام');
    expect(pdfDoc.kind).toBe('pdf');

    // A browser that sends a Word file as `octet-stream` is not turned away: the name decides.
    const word = await api(manager).upload(
      `/folders/${folder.id}/documents`,
      { buffer: await docx(), filename: 'policy.docx', contentType: 'application/octet-stream' },
      { name: 'السياسة العامة' },
    );
    expect(word.status, JSON.stringify(word.body)).toBe(201);
    wordDoc = data<ComplianceDocumentDto>(word);
    expect(wordDoc).toMatchObject({ name: 'السياسة العامة', kind: 'word', mime: DOCX_TYPE });

    const excel = await api(manager).upload(`/folders/${folder.id}/documents`, {
      buffer: await xlsx(),
      filename: 'risks.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(excel.status, JSON.stringify(excel.body)).toBe(201);
  });

  it('refuse anything else, and anything that is not what its name says', async () => {
    const text = await api(manager).upload(`/folders/${folder.id}/documents`, {
      buffer: Buffer.from('hello'),
      filename: 'notes.txt',
      contentType: 'text/plain',
    });
    expect(text.status).toBe(422);
    expect(code(text)).toBe('FILE_TYPE_NOT_ALLOWED');
    const renamed = await api(manager).upload(`/folders/${folder.id}/documents`, {
      buffer: PNG,
      filename: 'scan.pdf',
      contentType: PDF_TYPE,
    });
    expect(renamed.status).toBe(422);
    expect(code(renamed)).toBe('COMPLIANCE_FILE_CONTENT_MISMATCH');
  });

  it('refuse a file over 20 MB', async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(21 * 1024 * 1024)]);
    const res = await api(manager).upload(`/folders/${folder.id}/documents`, {
      buffer: big,
      filename: 'big.pdf',
      contentType: PDF_TYPE,
    });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('FILE_TOO_LARGE');
  });

  it('are listed to a reader without the seen line, and to the manager with it', async () => {
    const asReader = data<ComplianceDocumentDto[]>(
      await api(readerA).get(`/folders/${folder.id}/documents`),
    );
    expect(asReader).toHaveLength(3);
    expect(asReader.every((doc) => doc.seen === null)).toBe(true);
    const asManager = data<ComplianceDocumentDto[]>(
      await api(manager).get(`/folders/${folder.id}/documents`),
    );
    expect(asManager.every((doc) => doc.seen?.sharedWith === 2 && doc.seen.seenBy === 0)).toBe(
      true,
    );
    const shelf = data<ComplianceFolderDto[]>(await api(readerA).get('/folders'));
    expect(shelf[0]?.documentCount).toBe(3);
    expect(shelf[0]?.lastUploadedAt).not.toBeNull();
  });

  it('may be renamed by the responsible person and by nobody else', async () => {
    expect(
      (await api(readerA).patch(`/documents/${pdfDoc.id}`, { name: 'x', version: pdfDoc.version }))
        .status,
    ).toBe(403);
    const res = await api(manager).patch(`/documents/${pdfDoc.id}`, {
      name: 'دليل الالتزام 2026',
      version: pdfDoc.version,
    });
    expect(res.status).toBe(200);
    pdfDoc = data<ComplianceDocumentDto>(res);
    expect(pdfDoc.name).toBe('دليل الالتزام 2026');
    expect(
      (await api(readerA).delete(`/documents/${pdfDoc.id}?version=${pdfDoc.version}`)).status,
    ).toBe(403);
  });
});

describe('opening, downloading and the seen report', () => {
  it('lets a reader view and download, and counts each', async () => {
    const view = await api(readerA).get(`/documents/${pdfDoc.id}/content?mode=view`);
    expect(view.status).toBe(200);
    expect(view.headers['content-disposition']).toMatch(/^inline/);
    expect(
      Buffer.from(view.body as Buffer)
        .subarray(0, 5)
        .toString('latin1'),
    ).toBe('%PDF-');
    await api(readerA).get(`/documents/${pdfDoc.id}/content?mode=view`);
    const download = await api(readerA).get(`/documents/${pdfDoc.id}/content?mode=download`);
    expect(download.status).toBe(200);
    expect(download.headers['content-disposition']).toMatch(/^attachment/);
    expect(download.headers['content-disposition']).toContain(
      encodeURIComponent('دليل الالتزام.pdf'),
    );
  });

  it('reads a Word file into the page, counted as one opening', async () => {
    const res = await api(readerB).get(`/documents/${wordDoc.id}/preview`);
    expect(res.status).toBe(200);
    expect(data<CompliancePreviewDto>(res)).toEqual({
      kind: 'document',
      truncated: false,
      blocks: [
        { type: 'heading', text: 'سياسة مكافحة غسل الأموال' },
        { type: 'paragraph', text: 'يلتزم كل موظف بالإبلاغ.' },
        {
          type: 'table',
          rows: [
            ['البند', 'الحد'],
            ['نقدي', '100000'],
          ],
        },
      ],
    });
  });

  it('does not count a file it could not show as seen', async () => {
    const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const old = await api(manager).upload(`/folders/${folder.id}/documents`, {
      buffer: OLE,
      filename: 'older.doc',
      contentType: 'application/msword',
    });
    expect(old.status, JSON.stringify(old.body)).toBe(201);
    const doc = data<ComplianceDocumentDto>(old);
    const preview = await api(readerB).get(`/documents/${doc.id}/preview`);
    expect(data<CompliancePreviewDto>(preview)).toEqual({ kind: 'unavailable' });
    const report = data<ComplianceSeenReportDto>(
      await api(manager).get(`/documents/${doc.id}/views`),
    );
    expect(report.viewers.every((row) => !row.seen)).toBe(true);
    // A password-protected .docx is a compound file too, and is kept.
    const locked = await api(manager).upload(`/folders/${folder.id}/documents`, {
      buffer: OLE,
      filename: 'protected.docx',
      contentType: DOCX_TYPE,
    });
    expect(locked.status).toBe(201);
    for (const made of [doc, data<ComplianceDocumentDto>(locked)]) {
      expect(
        (await api(manager).delete(`/documents/${made.id}?version=${made.version}`)).status,
      ).toBe(204);
    }
  });

  it('answers a hidden file and a missing one alike', async () => {
    const hidden = await api(stranger).get(`/documents/${pdfDoc.id}/content`);
    const missing = await api(stranger).get(
      `/documents/${new Types.ObjectId().toHexString()}/content`,
    );
    expect([hidden.status, missing.status]).toEqual([404, 404]);
    expect((hidden.body as { error: { message: string } }).error.message).toBe(
      (missing.body as { error: { message: string } }).error.message,
    );
  });

  it('does not count the responsible person’s own openings', async () => {
    expect((await api(manager).get(`/documents/${pdfDoc.id}/content`)).status).toBe(200);
  });

  it('keeps a stranger out of a file as out of its folder', async () => {
    expect((await api(stranger).get(`/documents/${pdfDoc.id}/content`)).status).toBe(404);
    expect((await api(stranger).get(`/documents/${pdfDoc.id}/preview`)).status).toBe(404);
  });

  it('keeps the platform’s own download path shut to a reader', async () => {
    const docs = await api(manager).get(`/folders/${folder.id}/documents`);
    expect(docs.status).toBe(200);
    const { ComplianceDocumentModel } =
      await import('../../src/modules/compliance/documents/document.model');
    const stored = await ComplianceDocumentModel.findById(pdfDoc.id).lean().exec();
    const res = await api(readerA).platform(`/files/${String(stored?.fileId)}/download`);
    expect([403, 404]).toContain(res.status);
  });

  it('tells the responsible person who has seen a file, how many times and when', async () => {
    expect((await api(readerA).get(`/documents/${pdfDoc.id}/views`)).status).toBe(403);
    const res = await api(manager).get(`/documents/${pdfDoc.id}/views`);
    expect(res.status).toBe(200);
    const report = data<ComplianceSeenReportDto>(res);
    // Who has not seen it comes first.
    expect(report.viewers.map((row) => [row.person.userId, row.seen])).toEqual([
      [readerB.id, false],
      [readerA.id, true],
    ]);
    const a = report.viewers[1];
    expect(a).toMatchObject({ viewCount: 2, downloadCount: 1 });
    expect(a?.events.map((event) => event.action)).toEqual(['download', 'view', 'view']);
    expect(a?.firstAt).not.toBeNull();
    expect(Date.parse(a?.lastAt ?? '')).toBeGreaterThanOrEqual(Date.parse(a?.firstAt ?? ''));
    expect(report.former).toEqual([]);

    const word = data<ComplianceSeenReportDto>(
      await api(manager).get(`/documents/${wordDoc.id}/views`),
    );
    expect(word.viewers.find((row) => row.person.userId === readerB.id)).toMatchObject({
      seen: true,
      viewCount: 1,
      downloadCount: 0,
    });

    const listed = data<ComplianceDocumentDto[]>(
      await api(manager).get(`/folders/${folder.id}/documents`),
    );
    expect(listed.find((doc) => doc.id === pdfDoc.id)?.seen).toEqual({ seenBy: 1, sharedWith: 2 });
  });
});

describe('taking a person off', () => {
  it('closes the folder to them, takes the page key back, and keeps their history apart', async () => {
    const res = await api(manager).patch(`/folders/${folder.id}`, {
      viewerUserIds: [readerB.id],
      version: folder.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    folder = data<ComplianceFolderDto>(res);
    expect(await readerRoleHeldBy(readerA.id)).toBe(false);
    readerA = await refresh(readerA);
    expect((await api(readerA).get('/folders')).status).toBe(403);

    const report = data<ComplianceSeenReportDto>(
      await api(manager).get(`/documents/${pdfDoc.id}/views`),
    );
    expect(report.viewers.map((row) => row.person.userId)).toEqual([readerB.id]);
    expect(report.former.map((row) => [row.person.userId, row.viewCount])).toEqual([
      [readerA.id, 2],
    ]);
  });

  it('records each write in the trail', async () => {
    const rows = await AuditLogModel.find({
      'entityRef.moduleId': 'compliance',
      'entityRef.entityType': 'folder',
      'entityRef.entityId': folder.id,
    })
      .lean()
      .exec();
    expect(rows.map((row) => row.action)).toEqual(expect.arrayContaining(['create', 'update']));
  });
});

describe('deleting', () => {
  it('a file takes it out of the folder for everyone', async () => {
    const res = await api(manager).delete(`/documents/${wordDoc.id}?version=${wordDoc.version}`);
    expect(res.status).toBe(204);
    expect((await api(readerB).get(`/documents/${wordDoc.id}/content`)).status).toBe(404);
  });

  it('a folder takes its files with it and closes the page to people on no other list', async () => {
    expect(
      (await api(manager).delete(`/folders/${folder.id}?version=${folder.version + 3}`)).status,
    ).toBe(409);
    const res = await api(manager).delete(`/folders/${folder.id}?version=${folder.version}`);
    expect(res.status).toBe(204);
    expect((await api(manager).get(`/folders/${folder.id}`)).status).toBe(404);
    expect((await api(manager).get(`/documents/${pdfDoc.id}/content`)).status).toBe(404);
    expect(await readerRoleHeldBy(readerB.id)).toBe(false);
  });
});

describe('the people picker', () => {
  it('offers active employee accounts only', async () => {
    const res = await api(manager).get('/people?search=compliance&pageSize=100');
    expect(res.status).toBe(200);
    const ids = data<CompliancePersonDto[]>(res).map((p) => p.userId);
    expect(ids).toEqual(expect.arrayContaining([readerA.id, readerB.id]));
    expect(ids).not.toContain(customer.id);
    expect(ids).not.toContain(adminId);
  });
});
