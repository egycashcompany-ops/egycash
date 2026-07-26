// Contracts module integration suite (frozen design §5 + Revisions 1–2). Covers the
// template lifecycle (sanitize / unknown-placeholder / publish gate / version-on-edit /
// clone / archive), the contract lifecycle (approval gate A7, generation with pinned
// version A2 + variable snapshot A3 + integrity A14, the A16 loud validation report,
// the Q3 one-active rule, signing → immutability A4, amend/renew chains D9, terminate,
// the D11 expire + expiring-soon sweeps), numbering (A1), search (A12), attachments
// (A6), the PDF-disabled fallback (D8) and the A22 query seam. The IMMUTABILITY PROOF:
// editing the template after generation never changes a stored snapshot.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  HrContractSettingKeys,
  type ContractDto,
  type ContractPreviewDto,
  type ContractTemplateDto,
  type ContractTypeDto,
  type EmployeeDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import {
  contractQueryService,
  contractService,
  renderContractPdf,
} from '../../src/modules/hr/contracts/contracts';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { organizationService } from '../../src/platform/organization';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const START_DATE = '2026-08-01';
const FAR_END_DATE = '2028-07-31';
let JOB_TITLE_ID = '';
let BRANCH_ID = '';
let DEPARTMENT_ID = '';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId = '';
let adminToken = '';
let aliceToken = '';
let phoneCounter = 40_000_000;
let nidCounter = 0;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-contracts-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (email: string): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

const login = async (email: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const nextPhone = (): string => `010${String(phoneCounter++).padStart(8, '0')}`;
const nextNid = (): string => `290010101${String(20_000 + nidCounter++).padStart(5, '0')}`;

const settingsCtx = (): AuthContext => ({
  userId: adminId,
  sessionId: 'seed',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'en',
  permissions: { 'setting.edit': 'organization' },
  permissionVersion: 1,
  isPrivileged: true,
});

const setContractsSetting = async (key: string, value: unknown): Promise<void> => {
  await settingsService.set(settingsCtx(), { key, scope: 'organization', value });
};

const mkEmployee = async (withNid = true): Promise<EmployeeDto> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: {
          fullNameAr: 'موظف العقود',
          ...(withNid ? { nationalId: nextNid() } : {}),
          nationality: 'Egyptian',
        },
        contact: { primaryPhone: nextPhone() },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId: JOB_TITLE_ID,
        departmentId: DEPARTMENT_ID,
        branchId: BRANCH_ID,
        employmentType: 'fullTime',
        probationMonths: 0,
        startDate: '2026-07-01T00:00:00.000Z',
      },
      entryStatus: 'active',
    });
  expect(res.status).toBe(201);
  return res.body.data as EmployeeDto;
};

const mkType = async (over: Record<string, unknown> = {}): Promise<ContractTypeDto> => {
  const res = await request(app)
    .post('/api/v1/hr/contract-types')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: { ar: 'دوام كامل', en: 'Full time' }, ...over });
  expect(res.status).toBe(201);
  return res.body.data as ContractTypeDto;
};

const DEFAULT_BODY =
  '<p>عقد رقم {{contract.code}} بين {{company.name}} والموظف {{employee.fullName}} ' +
  '({{employee.employeeCode}}) بوظيفة {{job.title}} بفرع {{branch.name}} ' +
  'اعتبارًا من {{contract.startDate}}.</p>';

const mkTemplate = async (
  typeId: string,
  over: Record<string, unknown> = {},
): Promise<ContractTemplateDto> => {
  const res = await request(app)
    .post('/api/v1/hr/contract-templates')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: { ar: 'قالب أساسي', en: 'Base template' },
      language: 'ar',
      contractTypeId: typeId,
      sections: { header: '<p>{{company.name}}</p>', body: DEFAULT_BODY, footer: '' },
      logoFileId: null,
      signatures: [
        { key: 'employer', label: 'الطرف الأول' },
        { key: 'employee', label: 'الطرف الثاني' },
      ],
      ...over,
    });
  expect(res.status).toBe(201);
  return res.body.data as ContractTemplateDto;
};

const publishTemplate = async (template: ContractTemplateDto): Promise<ContractTemplateDto> => {
  const res = await request(app)
    .post(`/api/v1/hr/contract-templates/${template.id}/publish`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: template.version });
  expect(res.status).toBe(200);
  return res.body.data as ContractTemplateDto;
};

const publishedTemplate = async (typeId: string, over: Record<string, unknown> = {}) =>
  publishTemplate(await mkTemplate(typeId, over));

const mkDraft = async (
  employeeId: string,
  typeId: string,
  templateId: string,
  over: Record<string, unknown> = {},
): Promise<ContractDto> => {
  const res = await request(app)
    .post('/api/v1/hr/contracts')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ employeeId, typeId, templateId, startDate: START_DATE, endDate: FAR_END_DATE, ...over });
  expect(res.status).toBe(201);
  return res.body.data as ContractDto;
};

const generate = async (contract: ContractDto): Promise<ContractDto> => {
  const res = await request(app)
    .post(`/api/v1/hr/contracts/${contract.id}/generate`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: contract.version });
  expect(res.status).toBe(200);
  return res.body.data as ContractDto;
};

/** Draft + generate against a fresh employee (approval is OFF past the approval suite). */
const generated = async (typeId: string, templateId: string): Promise<ContractDto> => {
  const employee = await mkEmployee();
  const draft = await mkDraft(employee.id, typeId, templateId);
  return generate(draft);
};

const getContract = async (id: string): Promise<ContractDto> => {
  const res = await request(app).get(`/api/v1/hr/contracts/${id}`).set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return res.body.data as ContractDto;
};

const documentOf = async (id: string): Promise<string> => {
  const res = await request(app)
    .get(`/api/v1/hr/contracts/${id}/document`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('text/html');
  return res.text;
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  adminId = await mkUser('admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  await mkUser('alice@ecms.local');

  await settingsService.set(settingsCtx(), {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  await organizationService.ensure({ name: { ar: 'إيجي كاش', en: 'EGYCASH' } });

  adminToken = await login('admin@ecms.local');
  aliceToken = await login('alice@ecms.local');

  const branchRes = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '001', name: { ar: 'الرئيسي', en: 'HQ' } });
  expect(branchRes.status).toBe(201);
  BRANCH_ID = (branchRes.body as { data: { id: string } }).data.id;
  const depRes = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ branchId: BRANCH_ID, code: 'DEP-OPS-1', name: { ar: 'العمليات', en: 'Ops' } });
  expect(depRes.status).toBe(201);
  DEPARTMENT_ID = (depRes.body as { data: { id: string } }).data.id;
  const titleRes = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'JT-OPS-1', name: { ar: 'صراف', en: 'Cashier' }, jobGrade: 'G5' });
  expect(titleRes.status).toBe(201);
  JOB_TITLE_ID = (titleRes.body as { data: { id: string } }).data.id;
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('contracts — permissions', () => {
  it('denies every surface to a user without contract permissions', async () => {
    for (const path of ['/api/v1/hr/contracts', '/api/v1/hr/contract-types', '/api/v1/hr/contract-templates']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${aliceToken}`);
      expect(res.status).toBe(403);
    }
  });

  it('serves the server-owned variable catalog to contract users', async () => {
    const res = await request(app).get('/api/v1/hr/contracts/variables').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const keys = (res.body.data as { key: string }[]).map((v) => v.key);
    expect(keys).toContain('employee.fullName');
    expect(keys).toContain('contract.code');
  });
});

describe('contract templates — sanitize, placeholders, publish gate, versions (D4/A17/A19)', () => {
  let typeId = '';
  beforeAll(async () => {
    typeId = (await mkType()).id;
  });

  it('sanitizes sections on save: scripts stripped WITH content, unknown attrs dropped', async () => {
    const template = await mkTemplate(typeId, {
      sections: {
        header: '',
        body: '<p onclick="hack()">نص</p><script>alert(1)</script><iframe src="x"></iframe>',
        footer: '',
      },
    });
    expect(template.sections.body).toBe('<p>نص</p>');
  });

  it('rejects placeholders outside the server catalog (D5)', async () => {
    const res = await request(app)
      .post('/api/v1/hr/contract-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: { ar: 'خطأ', en: 'Bad' },
        language: 'ar',
        contractTypeId: typeId,
        sections: { header: '', body: '<p>{{no.such.variable}}</p>', footer: '' },
        logoFileId: null,
        signatures: [],
      });
    expect(res.status).toBe(422);
  });

  it('derives the placeholder list on save', async () => {
    const template = await mkTemplate(typeId);
    expect(template.placeholders).toContain('contract.code');
    expect(template.placeholders).toContain('employee.fullName');
    expect(template.status).toBe('draft');
    expect(template.templateVersion).toBe(1);
  });

  it('edits a DRAFT in place; editing a PUBLISHED version forks the next draft (A19)', async () => {
    const draft = await mkTemplate(typeId);
    const editedInPlace = await request(app)
      .patch(`/api/v1/hr/contract-templates/${draft.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: { ar: 'معدل', en: 'Edited' }, version: draft.version });
    expect(editedInPlace.status).toBe(200);
    expect((editedInPlace.body.data as ContractTemplateDto).id).toBe(draft.id);
    expect((editedInPlace.body.data as ContractTemplateDto).templateVersion).toBe(1);

    const published = await publishTemplate(editedInPlace.body.data as ContractTemplateDto);
    expect(published.status).toBe('published');
    const forked = await request(app)
      .patch(`/api/v1/hr/contract-templates/${published.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: { ar: 'الجيل الثاني', en: 'Gen 2' }, version: published.version });
    expect(forked.status).toBe(200);
    const forkedDto = forked.body.data as ContractTemplateDto;
    expect(forkedDto.id).not.toBe(published.id);
    expect(forkedDto.key).toBe(published.key);
    expect(forkedDto.templateVersion).toBe(2);
    expect(forkedDto.status).toBe('draft');

    // The version chain is recoverable (A19).
    const versions = await request(app)
      .get(`/api/v1/hr/contract-templates/keys/${published.key}/versions`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(versions.status).toBe(200);
    expect((versions.body.data as ContractTemplateDto[]).map((v) => v.templateVersion)).toEqual([2, 1]);
  });

  it('publishing supersedes the prior published version — one published per key (A17)', async () => {
    const v1 = await publishedTemplate(typeId);
    const forked = await request(app)
      .patch(`/api/v1/hr/contract-templates/${v1.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: { ar: 'v2', en: 'v2' }, version: v1.version });
    const v2 = await publishTemplate(forked.body.data as ContractTemplateDto);
    expect(v2.templateVersion).toBe(2);
    const versions = await request(app)
      .get(`/api/v1/hr/contract-templates/keys/${v1.key}/versions`)
      .set('Authorization', `Bearer ${adminToken}`);
    const byVersion = new Map((versions.body.data as ContractTemplateDto[]).map((v) => [v.templateVersion, v.status]));
    expect(byVersion.get(2)).toBe('published');
    expect(byVersion.get(1)).toBe('archived');
  });

  it('clones into a NEW independent key (Q2 cross-language path)', async () => {
    const source = await publishedTemplate(typeId);
    const res = await request(app)
      .post(`/api/v1/hr/contract-templates/${source.id}/clone`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: { ar: 'نسخة إنجليزية', en: 'English copy' }, language: 'en' });
    expect(res.status).toBe(201);
    const clone = res.body.data as ContractTemplateDto;
    expect(clone.key).not.toBe(source.key);
    expect(clone.language).toBe('en');
    expect(clone.templateVersion).toBe(1);
    expect(clone.status).toBe('draft');
    expect(clone.sections.body).toBe(source.sections.body);
  });

  it('archived versions refuse edits', async () => {
    const template = await mkTemplate(typeId);
    const archived = await request(app)
      .post(`/api/v1/hr/contract-templates/${template.id}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: template.version });
    expect(archived.status).toBe(200);
    const edit = await request(app)
      .patch(`/api/v1/hr/contract-templates/${template.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: { ar: 'x', en: 'x' }, version: (archived.body.data as ContractTemplateDto).version });
    expect(edit.status).toBe(422);
  });

  it('annotates the list with the published pin the create wizard uses', async () => {
    const v1 = await publishedTemplate(typeId);
    const list = await request(app).get('/api/v1/hr/contract-templates').set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const row = (list.body.data as ContractTemplateDto[]).find((x) => x.key === v1.key);
    expect(row?.publishedTemplateId).toBe(v1.id);
    expect(row?.publishedTemplateVersion).toBe(1);
  });
});

describe('contracts — approval gate (A7, requireApproval default ON)', () => {
  it('draft → submit → reject → resubmit → approve → generate', async () => {
    const type = await mkType();
    const template = await publishedTemplate(type.id);
    const employee = await mkEmployee();
    const draft = await mkDraft(employee.id, type.id, template.id);
    expect(draft.status).toBe('draft');
    expect(draft.approval?.required).toBe(true);
    expect(draft.code).toMatch(/^ECMS-CON-\d{4}-\d{6}$/);

    // Generation is blocked while approval is pending (the default gate).
    const blocked = await request(app)
      .post(`/api/v1/hr/contracts/${draft.id}/generate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: draft.version });
    expect(blocked.status).toBe(422);

    const submitted = await request(app)
      .post(`/api/v1/hr/contracts/${draft.id}/submit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: draft.version });
    expect((submitted.body.data as ContractDto).status).toBe('pendingApproval');

    const rejected = await request(app)
      .post(`/api/v1/hr/contracts/${draft.id}/approval`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'rejected', note: 'fix dates', version: (submitted.body.data as ContractDto).version });
    expect((rejected.body.data as ContractDto).status).toBe('draft');
    expect((rejected.body.data as ContractDto).approval?.steps).toHaveLength(1);

    const resubmitted = await request(app)
      .post(`/api/v1/hr/contracts/${draft.id}/submit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: (rejected.body.data as ContractDto).version });
    const approved = await request(app)
      .post(`/api/v1/hr/contracts/${draft.id}/approval`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'approved', version: (resubmitted.body.data as ContractDto).version });
    expect((approved.body.data as ContractDto).status).toBe('approved');

    const active = await generate(approved.body.data as ContractDto);
    expect(active.status).toBe('active');
    expect(active.hasSnapshot).toBe(true);
  });
});

describe('contracts — generation, snapshot, integrity (approval OFF from here)', () => {
  let typeId = '';
  let templateId = '';
  beforeAll(async () => {
    await setContractsSetting(HrContractSettingKeys.RequireApproval, false);
    const type = await mkType();
    typeId = type.id;
    templateId = (await publishedTemplate(typeId)).id;
  });

  it('freezes the snapshot: pinned version, variables with provenance, SHA-256 integrity (A2/A3/A14)', async () => {
    const employee = await mkEmployee();
    const draft = await mkDraft(employee.id, typeId, templateId, {
      overrides: [{ key: 'employee.fullName', value: 'الاسم المتفق عليه' }],
    });
    const active = await generate(draft);

    expect(active.status).toBe('active');
    expect(active.pinnedTemplateVersion).toBe(1);
    expect(active.generation.status).toBe('queued');
    expect(active.generation.integrity?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(active.generation.integrity?.templateVersion).toBe(1);
    expect(active.generation.integrity?.contractVersion).toBe(1);
    // A5 — signer records spawned from the template's blocks.
    expect(active.signers.map((s) => s.key)).toEqual(['employer', 'employee']);

    // A3 — provenance: the override is recorded as such; the rest resolve from data.
    const name = active.variables.find((v) => v.key === 'employee.fullName');
    expect(name?.value).toBe('الاسم المتفق عليه');
    expect(name?.source).toBe('override');
    const branch = active.variables.find((v) => v.key === 'branch.name');
    expect(branch?.value).toBe('الرئيسي');
    const company = active.variables.find((v) => v.key === 'company.name');
    expect(company?.value).toBe('إيجي كاش');

    // The stored document contains the substituted values — never a raw {{…}}.
    const html = await documentOf(active.id);
    expect(html).toContain('الاسم المتفق عليه');
    expect(html).toContain(active.code);
    expect(html).not.toMatch(/\{\{/);
  });

  it('refuses generation for a template key with NO published version (A17 gate)', async () => {
    const draftOnly = await mkTemplate(typeId);
    const employee = await mkEmployee();
    const draft = await mkDraft(employee.id, typeId, draftOnly.id);
    const res = await request(app)
      .post(`/api/v1/hr/contracts/${draft.id}/generate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: draft.version });
    expect(res.status).toBe(422);
    expect((res.body as { error: { code: string } }).error.code).toBe('CONTRACT_TEMPLATE_NOT_PUBLISHED');
  });

  it('fails LOUD with the missing-variable report, then generates once overridden (A16)', async () => {
    const template = await publishedTemplate(typeId, {
      sections: { header: '', body: '<p>{{employee.nationalId}} — {{contract.code}}</p>', footer: '' },
    });
    const employee = await mkEmployee(false); // no national id on file
    const draft = await mkDraft(employee.id, typeId, template.id);
    const res = await request(app)
      .post(`/api/v1/hr/contracts/${draft.id}/generate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: draft.version });
    expect(res.status).toBe(422);
    const error = (res.body as { error: { code: string; message: string } }).error;
    expect(error.code).toBe('CONTRACT_VARIABLES_MISSING');
    expect(error.message).toContain('employee.nationalId');

    const patched = await request(app)
      .patch(`/api/v1/hr/contracts/${draft.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ overrides: [{ key: 'employee.nationalId', value: '29001011234567' }], version: draft.version });
    expect(patched.status).toBe(200);
    const active = await generate(patched.body.data as ContractDto);
    expect(active.status).toBe('active');
    expect(active.variables.find((v) => v.key === 'employee.nationalId')?.source).toBe('override');
  });

  it('enforces ONE active contract per employee per type, unless the type allows multiple (Q3)', async () => {
    const employee = await mkEmployee();
    await generate(await mkDraft(employee.id, typeId, templateId));
    const second = await request(app)
      .post('/api/v1/hr/contracts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: employee.id, typeId, templateId, startDate: START_DATE, endDate: FAR_END_DATE });
    expect(second.status).toBe(422);

    const multiType = await mkType({ name: { ar: 'استشاري', en: 'Consultancy' }, multipleActiveAllowed: true });
    const multiTemplate = await publishedTemplate(multiType.id);
    await generate(await mkDraft(employee.id, multiType.id, multiTemplate.id));
    const third = await mkDraft(employee.id, multiType.id, multiTemplate.id);
    expect(third.status).toBe('draft');
  });

  it('IMMUTABILITY PROOF: editing the template after generation never touches the snapshot (A2/A20)', async () => {
    const template = await publishedTemplate(typeId);
    const contract = await generated(typeId, template.id);
    const before = await documentOf(contract.id);

    // Edit the published template (forks draft v2) and publish v2.
    const forked = await request(app)
      .patch(`/api/v1/hr/contract-templates/${template.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        sections: { header: '', body: '<p>نص جديد كليًا {{contract.code}}</p>', footer: '' },
        version: template.version,
      });
    await publishTemplate(forked.body.data as ContractTemplateDto);

    // The stored snapshot is byte-identical.
    const after = await documentOf(contract.id);
    expect(after).toBe(before);
    expect((await getContract(contract.id)).pinnedTemplateVersion).toBe(1);

    // A NEW contract on the same key pins the NEW published version.
    const next = await generated(typeId, template.id);
    expect(next.pinnedTemplateVersion).toBe(2);
    expect(await documentOf(next.id)).toContain('نص جديد كليًا');
  });

  it('renders the live preview through the same engine, plus the sample mode (A18)', async () => {
    const employee = await mkEmployee();
    const res = await request(app)
      .post('/api/v1/hr/contracts/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: employee.id, templateId, startDate: START_DATE, overrides: [] });
    expect(res.status).toBe(200);
    const preview = res.body.data as ContractPreviewDto;
    expect(preview.html).toContain('موظف العقود');
    expect(Array.isArray(preview.issues)).toBe(true);

    // The template editor's sample render: no employee → catalog sample values.
    const sample = await request(app)
      .post('/api/v1/hr/contracts/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ templateId, overrides: [] });
    expect(sample.status).toBe(200);
    expect((sample.body.data as ContractPreviewDto).html).toContain('أحمد محمد علي');
    expect((sample.body.data as ContractPreviewDto).issues).toEqual([]);
  });
});

describe('contracts — signing, immutability, amend/renew chains (A4/A5/D9)', () => {
  let typeId = '';
  let templateId = '';
  beforeAll(async () => {
    const type = await mkType();
    typeId = type.id;
    templateId = (await publishedTemplate(type.id)).id;
  });

  const signBlock = async (contract: ContractDto, key: string): Promise<ContractDto> => {
    const res = await request(app)
      .post(`/api/v1/hr/contracts/${contract.id}/sign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key, version: contract.version });
    expect(res.status).toBe(200);
    return res.body.data as ContractDto;
  };

  it('records signatures per block; all signed → SIGNED → immutable (A4)', async () => {
    const contract = await generated(typeId, templateId);
    const afterOne = await signBlock(contract, 'employer');
    expect(afterOne.status).toBe('active');
    expect(afterOne.signers.find((s) => s.key === 'employer')?.status).toBe('signed');

    const afterAll_ = await signBlock(afterOne, 'employee');
    expect(afterAll_.status).toBe('signed');

    // Draft-style edits refuse with the typed immutability error.
    const edit = await request(app)
      .patch(`/api/v1/hr/contracts/${contract.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ referenceNumber: 'X', version: afterAll_.version });
    expect(edit.status).toBe(422);
    expect((edit.body as { error: { code: string } }).error.code).toBe('CONTRACT_IMMUTABLE');
  });

  it('amend: next version of the SAME code; generating it supersedes the predecessor', async () => {
    const v1 = await generated(typeId, templateId);
    const amendRes = await request(app)
      .post(`/api/v1/hr/contracts/${v1.id}/amend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ startDate: '2026-09-01', endDate: FAR_END_DATE, overrides: [], version: v1.version });
    expect(amendRes.status).toBe(201);
    const v2draft = amendRes.body.data as ContractDto;
    expect(v2draft.code).toBe(v1.code);
    expect(v2draft.contractVersion).toBe(2);
    expect(v2draft.status).toBe('draft');

    const v2 = await generate(v2draft);
    expect(v2.generation.integrity?.contractVersion).toBe(2);
    const v1after = await getContract(v1.id);
    expect(v1after.status).toBe('amended');
    expect(v1after.supersededById).toBe(v2.id);

    // The superseded version can be archived; its snapshot remains readable.
    const archived = await request(app)
      .post(`/api/v1/hr/contracts/${v1.id}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: v1after.version });
    expect((archived.body.data as ContractDto).status).toBe('archived');
    expect(await documentOf(v1.id)).toContain(v1.code);
  });

  it('renew: a NEW linked contract; generating it marks the source renewed', async () => {
    const source = await generated(typeId, templateId);
    const renewRes = await request(app)
      .post(`/api/v1/hr/contracts/${source.id}/renew`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ startDate: '2028-08-01', endDate: null, overrides: [], version: source.version });
    expect(renewRes.status).toBe(201);
    const renewal = renewRes.body.data as ContractDto;
    expect(renewal.code).not.toBe(source.code);
    expect(renewal.parentContractId).toBe(source.id);

    await generate(renewal);
    const sourceAfter = await getContract(source.id);
    expect(sourceAfter.status).toBe('renewed');
    expect(sourceAfter.supersededById).toBe(renewal.id);
  });

  it('terminates an active contract with reason + date', async () => {
    const contract = await generated(typeId, templateId);
    const res = await request(app)
      .post(`/api/v1/hr/contracts/${contract.id}/terminate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'اتفاق الطرفين', date: '2026-12-31', version: contract.version });
    expect(res.status).toBe(200);
    const dto = res.body.data as ContractDto;
    expect(dto.status).toBe('terminated');
    expect(dto.terminationReason).toBe('اتفاق الطرفين');
  });
});

describe('contracts — numbering setting, search, sweeps, PDF fallback, attachments, query seam', () => {
  let typeId = '';
  let templateId = '';
  beforeAll(async () => {
    const type = await mkType();
    typeId = type.id;
    templateId = (await publishedTemplate(type.id)).id;
  });

  it('applies a custom number format to FUTURE contracts only (A1)', async () => {
    await setContractsSetting(HrContractSettingKeys.NumberFormat, 'EGY/{year}/{seq:4}');
    const employee = await mkEmployee();
    const draft = await mkDraft(employee.id, typeId, templateId);
    expect(draft.code).toMatch(/^EGY\/\d{4}\/\d{4}$/);
    await setContractsSetting(HrContractSettingKeys.NumberFormat, 'ECMS-CON-{year}-{seq:6}');
  });

  it('finds contracts by free text — code and reference number (A12)', async () => {
    const employee = await mkEmployee();
    const reference = `REF-${Date.now()}`;
    const contract = await generate(
      await mkDraft(employee.id, typeId, templateId, { referenceNumber: reference }),
    );
    for (const term of [contract.code, reference]) {
      const res = await request(app)
        .get('/api/v1/hr/contracts')
        .query({ search: term })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect((res.body.data as ContractDto[]).some((c) => c.id === contract.id)).toBe(true);
    }
  });

  it('expires overdue contracts and notifies expiring ones exactly once (D11)', async () => {
    const employee = await mkEmployee();
    const overdue = await generate(
      await mkDraft(employee.id, typeId, templateId, { startDate: '2020-01-01', endDate: '2020-12-31' }),
    );
    await contractService.expireOverdue();
    expect((await getContract(overdue.id)).status).toBe('expired');

    const soonEnd = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const employee2 = await mkEmployee();
    const expiring = await generate(
      await mkDraft(employee2.id, typeId, templateId, { endDate: soonEnd }),
    );
    const first = await contractService.notifyExpiring();
    expect(first).toBeGreaterThanOrEqual(1);
    const second = await contractService.notifyExpiring();
    expect(second).toBe(0); // once per contract — expiryNoticeSentAt marks it
    expect((await getContract(expiring.id)).status).toBe('active');
  });

  it('completes generation without a PDF when the chromium driver is disabled (D8 fallback)', async () => {
    const contract = await generated(typeId, templateId);
    expect(contract.generation.status).toBe('queued');
    await renderContractPdf(contract.id); // the worker-side job, invoked in-process
    const after = await getContract(contract.id);
    expect(after.generation.status).toBe('completed');
    expect(after.generation.pdfFileId).toBeNull();

    const pdf = await request(app)
      .get(`/api/v1/hr/contracts/${contract.id}/pdf`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(pdf.status).toBe(200);
    expect((pdf.body.data as { ready: boolean }).ready).toBe(false);
    // …and the print-view fallback still serves the immutable snapshot.
    expect(await documentOf(contract.id)).toContain(contract.code);
  });

  it('uploads and removes attachments via the platform Files service (A6)', async () => {
    const contract = await generated(typeId, templateId);
    const uploaded = await request(app)
      .post(`/api/v1/hr/contracts/${contract.id}/attachments/upload`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('category', 'annex')
      .field('label', 'ملحق الراتب')
      .field('version', String(contract.version))
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'annex.pdf', contentType: 'application/pdf' });
    expect(uploaded.status).toBe(200);
    const dto = uploaded.body.data as ContractDto;
    expect(dto.attachments).toHaveLength(1);
    expect(dto.attachments[0]?.category).toBe('annex');

    const removed = await request(app)
      .delete(`/api/v1/hr/contracts/${contract.id}/attachments/${dto.attachments[0]?.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: dto.version });
    expect(removed.status).toBe(200);
    expect((removed.body.data as ContractDto).attachments).toHaveLength(0);
  });

  it('serves consumers ONLY through the query seam (A22)', async () => {
    const employee = await mkEmployee();
    const contract = await generate(await mkDraft(employee.id, typeId, templateId));

    const snapshot = await contractQueryService.getSnapshot(contract.id);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.code).toBe(contract.code);
    expect(snapshot?.integrity?.sha256).toBe(contract.generation.integrity?.sha256);
    expect(snapshot?.variables.length).toBeGreaterThan(0);

    const activeAt = await contractQueryService.activeSnapshotAt(employee.id, new Date('2027-01-01'));
    expect(activeAt?.contractId).toBe(contract.id);

    const list = await contractQueryService.listForEmployee(employee.id);
    expect(list.some((c) => c.contractId === contract.id)).toBe(true);
  });
});
