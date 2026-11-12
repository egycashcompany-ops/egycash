// Contracts module integration suite (frozen design §5 + Revisions 1–2). Covers the
// template lifecycle (sanitize / unknown-placeholder / publish gate / version-on-edit /
// clone / archive), the contract lifecycle (approval gate A7, generation with pinned
// version A2 + variable snapshot A3 + integrity A14, the A16 loud validation report,
// the Q3 one-active rule, signing → immutability A4, amend/renew chains D9, terminate,
// the D11 expire + expiring-soon sweeps), numbering (A1), search (A12), attachments
// (A6), the PDF-disabled fallback (D8) and the A22 query seam. The IMMUTABILITY PROOF:
// editing the template after generation never changes a stored snapshot.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
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
  type EmployeePapersDto,
  type HiringPackDto,
  type JobPapersDto,
  type InsuranceJobTitlesDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { cairoToday } from '../../src/modules/hr/shared/business-date';
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
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { ContractTemplateModel } from '../../src/modules/hr/contracts/contract-templates/contract-template.model';
import { syncHiringTemplates } from '../../src/modules/hr/contracts/hiring-templates';
import { JobTitleModel } from '../../src/platform/organization/job-titles/job-title.model';
import { formatTemplateDate } from '../../src/modules/hr/contracts/contracts/contract-variables';
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
          nationalId: nextNid(),
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
  const employee = res.body.data as EmployeeDto;
  if (!withNid) {
    // Registration REQUIRES a National ID, so an employee without one can no longer be created
    // through the API — but plenty of them exist, filed before that rule. The caller wants that
    // record, so put the row in the state those records are actually in. Clearing the stored
    // field is the whole of it: `employee.nationalId` resolves from `personal.nationalId`
    // (contract-variables.ts), which is what makes the variable report below fire.
    await EmployeeModel.updateOne({ _id: employee.id }, { $set: { 'personal.nationalId': null } }).exec();
  }
  return employee;
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

  it('tolerates unknown placeholders while DRAFTING; publish rejects them (D5 at the gate)', async () => {
    // A typo'd placeholder must not block Save Draft — D5 holds where it matters:
    // nothing unknown can publish, and therefore nothing unknown can ever generate.
    const res = await request(app)
      .post('/api/v1/hr/contract-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: { ar: 'مسودة بخطأ', en: 'Draft with typo' },
        language: 'ar',
        contractTypeId: typeId,
        sections: { header: '', body: '<p>{{no.such.variable}}</p>', footer: '' },
        logoFileId: null,
        signatures: [],
      });
    expect(res.status).toBe(201);
    const draft = res.body.data as ContractTemplateDto;
    expect(draft.placeholders).toContain('no.such.variable');

    const blocked = await request(app)
      .post(`/api/v1/hr/contract-templates/${draft.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: draft.version });
    expect(blocked.status).toBe(422);
    expect((blocked.body as { error: { message: string } }).error.message).toContain('no.such.variable');
  });

  it('derives the placeholder list on save', async () => {
    const template = await mkTemplate(typeId);
    expect(template.placeholders).toContain('contract.code');
    expect(template.placeholders).toContain('employee.fullName');
    expect(template.status).toBe('draft');
    expect(template.templateVersion).toBe(1);
  });

  it('saves an INCOMPLETE draft freely — publish is the only completeness gate', async () => {
    // Save Draft is never blocked: a draft is expected to be incomplete while authored —
    // no names, no type, empty body, an unlabeled signature row.
    const created = await request(app)
      .post('/api/v1/hr/contract-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: { ar: '', en: '' },
        language: 'ar',
        contractTypeId: null,
        sections: { header: '', body: '', footer: '' },
        logoFileId: null,
        signatures: [{ key: 'employer', label: '' }],
      });
    expect(created.status).toBe(201);
    const draft = created.body.data as ContractTemplateDto;
    expect(draft.status).toBe('draft');
    expect(draft.contractTypeId).toBeNull();

    // Publish blocks with a readable report of everything still missing.
    const blocked = await request(app)
      .post(`/api/v1/hr/contract-templates/${draft.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: draft.version });
    expect(blocked.status).toBe(422);
    const message = (blocked.body as { error: { message: string } }).error.message;
    for (const part of ['Arabic name', 'English name', 'contract type', 'body', 'signature labels']) {
      expect(message).toContain(part);
    }

    // Completing the draft unlocks publishing.
    const completed = await request(app)
      .patch(`/api/v1/hr/contract-templates/${draft.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: { ar: 'قالب مكتمل', en: 'Completed' },
        contractTypeId: typeId,
        sections: { header: '', body: '<p>{{contract.code}}</p>', footer: '' },
        signatures: [{ key: 'employer', label: 'الطرف الأول' }],
        version: draft.version,
      });
    expect(completed.status).toBe(200);
    const published = await publishTemplate(completed.body.data as ContractTemplateDto);
    expect(published.status).toBe('published');
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

  it('previews an UNSAVED inline template — nothing persisted, problems reported not blocking', async () => {
    const before = await request(app)
      .get('/api/v1/hr/contract-templates')
      .set('Authorization', `Bearer ${adminToken}`);
    const res = await request(app)
      .post('/api/v1/hr/contracts/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        inlineTemplate: {
          language: 'ar',
          sections: {
            header: '',
            body: '<p>{{employee.fullName}} — {{no.such.thing}} — {{contract.currentDate}}</p>',
            footer: '',
          },
          // An unlabeled just-added signature row must not block previewing either.
          signatures: [{ key: 'employer', label: '' }],
        },
        overrides: [],
      });
    expect(res.status).toBe(200);
    const preview = res.body.data as { html: string; issues: { placeholder: string; reason: string }[] };
    // Sample values render; the unknown placeholder is REPORTED, not a 422.
    expect(preview.html).toContain('أحمد محمد علي');
    expect(preview.issues.some((i) => i.placeholder === 'no.such.thing')).toBe(true);
    // Nothing was saved by previewing.
    const after = await request(app)
      .get('/api/v1/hr/contract-templates')
      .set('Authorization', `Bearer ${adminToken}`);
    expect((after.body.data as unknown[]).length).toBe((before.body.data as unknown[]).length);
  });

  it('resolves {{contract.currentDate}} to the Cairo-calendar date', async () => {
    const template = await publishedTemplate(typeId, {
      sections: { header: '', body: '<p>حُرِّر في {{contract.currentDate}} — {{contract.code}}</p>', footer: '' },
    });
    const contract = await generated(typeId, template.id);
    // An Arabic template writes it as the company's papers do: day/month/year (A27).
    const cairoDate = formatTemplateDate(cairoToday(), 'ar');
    const entry = contract.variables.find((v) => v.key === 'contract.currentDate');
    expect(entry?.value).toBe(cairoDate);
    expect(await documentOf(contract.id)).toContain(cairoDate);
  });

  it('verifies issued documents PUBLICLY via the QR pair — no authentication (A23)', async () => {
    const contract = await generated(typeId, templateId);
    const sha = contract.generation.integrity?.sha256 ?? '';
    // No Authorization header on purpose: the QR target must be world-readable.
    const okRes = await request(app)
      .get('/api/v1/hr/contracts/verify')
      .query({ code: contract.code, key: sha });
    expect(okRes.status).toBe(200);
    const verdict = okRes.body.data as { valid: boolean; code?: string; contractVersion?: number };
    expect(verdict.valid).toBe(true);
    expect(verdict.code).toBe(contract.code);
    expect(verdict.contractVersion).toBe(1);
    // The verdict never carries employee data.
    expect(JSON.stringify(okRes.body.data)).not.toContain('موظف');
    // Nor which release generated the document: world-readable, that is a version banner.
    expect(okRes.body.data).not.toHaveProperty('generatorVersion');

    const bad = await request(app)
      .get('/api/v1/hr/contracts/verify')
      .query({ code: contract.code, key: 'a'.repeat(64) });
    expect(bad.status).toBe(200);
    expect((bad.body.data as { valid: boolean }).valid).toBe(false);
  });

  it('applies the branding profile at generation and freezes it into the snapshot (A24)', async () => {
    const current = await request(app)
      .get('/api/v1/hr/contract-templates/branding')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(current.status).toBe(200);
    const branded = await request(app)
      .patch('/api/v1/hr/contract-templates/branding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        watermark: { ar: 'سري', en: 'CONFIDENTIAL' },
        footerText: { ar: 'إيجي كاش — جميع الحقوق محفوظة', en: 'EGYCASH — all rights reserved' },
        primaryColor: '#0a5c36',
        version: (current.body.data as { version: number }).version,
      });
    expect(branded.status).toBe(200);

    const contract = await generated(typeId, templateId); // an ARABIC template
    const html = await documentOf(contract.id);
    expect(html).toContain('سري'); // the language-matched watermark
    expect(html).toContain('إيجي كاش — جميع الحقوق محفوظة');
    expect(html).toContain('#0a5c36');

    // Changing branding later NEVER alters an issued snapshot (A2/A20).
    const rebrand = await request(app)
      .patch('/api/v1/hr/contract-templates/branding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        watermark: { ar: 'علامة جديدة', en: 'NEW MARK' },
        version: (branded.body.data as { version: number }).version,
      });
    expect(rebrand.status).toBe(200);
    expect(await documentOf(contract.id)).toBe(html);
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

/** An employee hired straight into `jobTitleId`, starting 15 November 2026 (A27). */
const employeeIn = async (jobTitleId: string): Promise<EmployeeDto> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: { fullNameAr: 'موظف المستندات', nationalId: nextNid(), nationality: 'Egyptian' },
        contact: { primaryPhone: nextPhone() },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId,
        departmentId: DEPARTMENT_ID,
        branchId: BRANCH_ID,
        employmentType: 'fullTime',
        probationMonths: 0,
        startDate: '2026-11-15T00:00:00.000Z',
      },
      entryStatus: 'active',
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as EmployeeDto;
};

const pack = (employeeId: string) =>
  request(app)
    .post('/api/v1/hr/contracts/hiring-pack')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ employeeId });

/**
 * «مستندات التعيين» (A27) — «عاوز يجبلي كل الحاجه اللي هتتطبع للشخص دا علي حسب وظيفتو». The
 * employee's contract first, then the forms of the employee's job; the contract made when there is
 * none — one year from the start date — and made once.
 */
describe('«مستندات التعيين» — the printed hiring set (A27)', () => {
  let jobId = '';
  let contractTemplate: ContractTemplateDto;
  let jobForm: ContractTemplateDto;
  let otherJobForm: ContractTemplateDto;

  const form = (over: Record<string, unknown>) =>
    mkTemplate('', {
      contractTypeId: null,
      kind: 'form',
      signatures: [],
      sections: {
        header: '',
        body: '<p>إقرار {{employee.fullName}} — رخصة {{employee.weaponLicenseExpiry}}</p>',
        footer: '',
      },
      ...over,
    });

  beforeAll(async () => {
    await setContractsSetting(HrContractSettingKeys.RequireApproval, false);
    const title = await request(app)
      .post('/api/v1/platform/job-titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'JT-PACK-1', name: { ar: 'قائد طاقم', en: 'Crew leader' }, jobGrade: 'G5' });
    expect(title.status).toBe(201);
    jobId = (title.body as { data: { id: string } }).data.id;

    const type = await mkType({ name: { ar: 'عقد محدد المدة', en: 'Fixed term' } });
    contractTemplate = await publishTemplate(
      await mkTemplate(type.id, {
        kind: 'contract',
        allJobs: false,
        jobTitleIds: [jobId],
        printOrder: 0,
        sections: { header: '', body: '<p>عقد {{employee.fullName}} من {{contract.startDate}} إلى {{contract.endDate}}</p>', footer: '' },
      }),
    );
    jobForm = await publishTemplate(await form({ name: { ar: 'إقرار السلاح', en: 'Weapon' }, allJobs: false, jobTitleIds: [jobId], printOrder: 5 }));
    otherJobForm = await publishTemplate(
      await form({ name: { ar: 'نموذج وظيفة أخرى', en: 'Other job' }, allJobs: false, jobTitleIds: [JOB_TITLE_ID] }),
    );
  });

  it('makes the contract when there is none, prints it first with the job\'s forms only, and makes it once', async () => {
    const employee = await employeeIn(jobId);
    const first = await pack(employee.id);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const set = first.body.data as HiringPackDto;
    expect(set.contractNote).toBeNull();
    expect(set.contract?.created).toBe(true);
    expect(set.documents[0]).toMatchObject({ key: contractTemplate.key, kind: 'contract' });
    const keys = set.documents.map((d) => d.key);
    expect(keys).toContain(jobForm.key);
    expect(keys).not.toContain(otherJobForm.key);
    // The contract's dates as the papers write them, and one year long.
    expect(set.html).toContain('عقد موظف المستندات من 15/11/2026 إلى 14/11/2027');
    // The form wears the letterhead and leaves a line where the record has nothing.
    expect(set.html).toContain('class="form-doc"');
    expect(set.html).toContain('إقرار موظف المستندات — رخصة <span class="blank">&nbsp;</span>');

    const contract = await getContract(set.contract?.id ?? '');
    expect(contract.status).toBe('active');
    expect(contract.startDate).toBe('2026-11-15');
    expect(contract.endDate).toBe('2027-11-14');

    // Printing again prints the same contract — it does not make a second one.
    const again = (await pack(employee.id)).body.data as HiringPackDto;
    expect(again.contract).toEqual({ id: set.contract?.id, code: set.contract?.code, created: false });
  });

  it('never makes a contract from a form', async () => {
    const employee = await employeeIn(jobId);
    const type = await mkType({ name: { ar: 'نوع آخر', en: 'Another' } });
    const res = await request(app)
      .post('/api/v1/hr/contracts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: employee.id, typeId: type.id, templateId: jobForm.id, startDate: START_DATE, endDate: null });
    expect(res.status).toBe(422);
  });

  it('offers an employee\'s papers on their tab, and prints only the ones chosen (A28)', async () => {
    const employee = await employeeIn(jobId);
    const listed = await request(app)
      .get(`/api/v1/hr/contracts/employee-papers/${employee.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const papers = listed.body.data as EmployeePapersDto;
    // No contract held yet: «العقد» stands for the job's contract template.
    expect(papers.contract).toBeNull();
    expect(papers.papers[0]).toMatchObject({ key: contractTemplate.key, kind: 'contract', group: 'contract' });
    expect(papers.papers.map((p) => p.key)).toContain(jobForm.key);
    expect(papers.papers.map((p) => p.key)).not.toContain(otherJobForm.key);

    // Only the job's form: no contract is made for a print that did not ask for it.
    const formOnly = (
      await request(app)
        .post('/api/v1/hr/contracts/hiring-pack')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ employeeId: employee.id, keys: [jobForm.key] })
    ).body.data as HiringPackDto;
    expect(formOnly.documents.map((d) => d.key)).toEqual([jobForm.key]);
    expect(formOnly.contract).toBeNull();
    expect(formOnly.contractNote).toBeNull();

    // The contract asked for: made, printed, and then listed as the one held.
    const withContract = (await pack(employee.id)).body.data as HiringPackDto;
    expect(withContract.contract?.created).toBe(true);
    const after = (
      await request(app)
        .get(`/api/v1/hr/contracts/employee-papers/${employee.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
    ).body.data as EmployeePapersDto;
    expect(after.contract).toMatchObject({ code: withContract.contract?.code, status: 'active', endDate: '2027-11-14' });
  });

  it('publishes a form without a contract type, but not one printed for no job at all', async () => {
    const draft = await form({ name: { ar: 'نموذج بلا وظائف', en: 'For nobody' }, allJobs: false, jobTitleIds: [] });
    const res = await request(app)
      .post(`/api/v1/hr/contract-templates/${draft.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: draft.version });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('the jobs it is printed for');
  });
});

/**
 * The owner's fourteen papers (A27, stage 2) — «هبعتلك الفايلات»: written into the templates on
 * boot, each once; a job's paper published for the jobs that carry its name, or waiting as a draft
 * until one does; and never written over somebody's edit.
 */
describe('the owner\'s papers — written into the templates on boot (A27, stage 2)', () => {
  const key = (name: string): string => `egycash.hiring.${name}`;
  const ALL_JOBS = ['contract', 'insurance-form-1', 'data-sheet', 'work-receipt', 'relatives', 'bank-letter'].map(key);
  let specialistJob = '';
  let crewLeaderJob = '';

  const jobNamed = async (code: string, ar: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/job-titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en: code }, jobGrade: 'G5' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  const row = async (name: string) => {
    const found = await ContractTemplateModel.find({ key: key(name) }).lean();
    expect(found, name).toHaveLength(1);
    return found[0]!;
  };

  beforeAll(async () => {
    await setContractsSetting(HrContractSettingKeys.RequireApproval, false);
    specialistJob = await jobNamed('JT-PAPER-1', 'أخصائى صراف آلى');
    // The crew leader the set's own tests made: «قائد طاقم».
    const leader = await JobTitleModel.findOne({ code: 'JT-PACK-1' }).lean();
    crewLeaderJob = String(leader?._id);
  });

  it('writes each paper once — published when it has its jobs, waiting when it has none yet', async () => {
    const first = await syncHiringTemplates();
    expect(first.published).toEqual(
      expect.arrayContaining([...ALL_JOBS, key('weapon'), key('card.atm-crew-leader'), key('card.atm-specialist')]),
    );
    expect(first.waiting).toEqual(expect.arrayContaining([key('card.security-guard'), key('card.treasurer')]));
    expect(first.published.length + first.waiting.length).toBe(14);
    expect(first.linked).toEqual([]);

    const contract = await row('contract');
    expect(contract).toMatchObject({ status: 'published', kind: 'contract', allJobs: true, printOrder: 0 });
    expect(contract.contractTypeId).not.toBeNull();
    // The weapon declaration prints for every job — ticked for crew leaders only.
    expect(await row('weapon')).toMatchObject({ status: 'published', allJobs: true, jobTitleIds: [] });
    expect(((await row('card.atm-specialist')).jobTitleIds ?? []).map(String)).toEqual([specialistJob]);
    expect(await row('card.security-guard')).toMatchObject({ status: 'draft', jobTitleIds: [] });

    // Again: nothing is written twice.
    const second = await syncHiringTemplates();
    expect(second).toEqual({ published: [], linked: [], waiting: first.waiting, widened: [], revised: [] });
    expect(await ContractTemplateModel.countDocuments({ key: { $regex: '^egycash\\.hiring\\.' } })).toBe(14);
  });

  it('publishes a waiting paper on the boot after its job is created — unless somebody edited it', async () => {
    const guardJob = await jobNamed('JT-PAPER-2', 'مراقب أمن');
    // HR has reworded the treasurer's card meanwhile: that draft is theirs now.
    const treasurer = await row('card.treasurer');
    const dto = (
      await request(app)
        .get(`/api/v1/hr/contract-templates/${String(treasurer._id)}`)
        .set('Authorization', `Bearer ${adminToken}`)
    ).body.data as ContractTemplateDto;
    const edit = await request(app)
      .patch(`/api/v1/hr/contract-templates/${dto.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: { ar: 'بطاقة أمين الخزينة', en: 'Treasurer' }, version: dto.version });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    await jobNamed('JT-PAPER-3', 'أمين خزينة');

    const third = await syncHiringTemplates();
    expect(third.linked).toEqual([key('card.security-guard')]);
    expect(await row('card.security-guard')).toMatchObject({ status: 'published' });
    expect(((await row('card.security-guard')).jobTitleIds ?? []).map(String)).toEqual([guardJob]);
    expect(await row('card.treasurer')).toMatchObject({ status: 'draft', jobTitleIds: [] });
  });

  it('publishes the card of a job created since, and prints the weapon declaration for every job', async () => {
    // A cash-in-transit specialist's job made now publishes the waiting card of that job.
    const citJob = await jobNamed('JT-PAPER-4', 'أخصائى نقل اموال');
    const fourth = await syncHiringTemplates();
    expect(fourth.linked).toEqual([key('card.cit-specialist')]);
    expect(((await row('card.cit-specialist')).jobTitleIds ?? []).map(String)).toEqual([citJob]);

    // A database an earlier release wrote: the weapon declaration for crew leaders and specialists.
    // The boot makes it every job's, as the release says — but only the row as the boot wrote it.
    await ContractTemplateModel.updateOne(
      { key: key('weapon') },
      { $set: { allJobs: false, jobTitleIds: [new Types.ObjectId(crewLeaderJob), new Types.ObjectId(citJob)] } },
    );
    expect((await syncHiringTemplates()).widened).toEqual([key('weapon')]);
    expect(await row('weapon')).toMatchObject({ allJobs: true, jobTitleIds: [] });
    // Again: nothing more.
    expect((await syncHiringTemplates()).widened).toEqual([]);

    // «لكلو بس مطفيه وللقائد معموله mark»: the specialist is offered it unticked; the crew leader, ticked.
    const offered = async (jobTitleId: string) => {
      const employee = await employeeIn(jobTitleId);
      const res = await request(app)
        .get(`/api/v1/hr/contracts/employee-papers/${employee.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body.data as EmployeePapersDto).papers.find((p) => p.key === key('weapon'));
    };
    expect(await offered(citJob)).toMatchObject({ optional: true });
    expect(await offered(crewLeaderJob)).toMatchObject({ optional: false });
  });

  it('rewrites a paper the boot wrote to his newer revision — never one somebody edited', async () => {
    // As a database written by an earlier release: the rows the boot wrote, at revision 1, filled.
    const old = { header: '<h3>قديم</h3>', body: '<p>{{employee.fullName}}</p>', footer: '' };
    for (const name of ['relatives', 'work-receipt']) {
      await ContractTemplateModel.updateOne(
        { key: key(name) },
        { $set: { sections: old, placeholders: ['employee.fullName'] }, $unset: { paperRevision: 1 } },
      );
    }
    // Somebody edits one of them since: it is theirs now.
    await ContractTemplateModel.updateOne({ key: key('work-receipt') }, { $set: { updatedBy: new Types.ObjectId() } });

    const report = await syncHiringTemplates();
    expect(report.revised).toEqual([key('relatives')]);
    const relatives = await row('relatives');
    expect(relatives.paperRevision).toBe(2);
    expect(relatives.placeholders).toEqual([]); // blank, as his paper
    expect(relatives.sections.footer).toContain('EGYCASH-HR-F-10-03');
    expect((await row('work-receipt')).sections).toEqual(old);
    // Again: nothing more.
    expect((await syncHiringTemplates()).revised).toEqual([]);
  });

  it('prints the owner\'s contract and the papers of the employee\'s job', async () => {
    const employee = await employeeIn(specialistJob);
    const res = await pack(employee.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const set = res.body.data as HiringPackDto;
    expect(set.contractNote).toBeNull();
    expect(set.documents.map((d) => d.key)).toEqual([...ALL_JOBS, key('card.atm-specialist')]);
    expect(set.html).toContain('عقد عمل محدد المدة');
    expect(set.html).toContain('السيد/ موظف المستندات');
    expect(set.html).toContain('تبدأ من 15/11/2026 وتنتهي في 14/11/2027');
    expect(set.html).toContain(`ربط الحساب بكود الموظف ${employee.code}`);
    expect(set.html).not.toContain('{{');

    // A crew leader signs the weapon declaration and the ATM crew leader's card besides.
    const leader = await employeeIn(crewLeaderJob);
    const leaders = (await pack(leader.id)).body.data as HiringPackDto;
    const keys = leaders.documents.map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining([key('weapon'), key('card.atm-crew-leader')]));
    expect(keys).not.toContain(key('card.atm-specialist'));
  });

  it('«مستندات الوظائف»: every department, its jobs, and what each prints there — saved, and printed so (A28)', async () => {
    const read = async (token = adminToken) =>
      request(app).get('/api/v1/hr/contracts/job-papers').set('Authorization', `Bearer ${token}`);
    const save = async (body: object, token = adminToken) =>
      request(app).patch('/api/v1/hr/contracts/job-papers').set('Authorization', `Bearer ${token}`).send(body);
    const lineOf = (data: JobPapersDto, departmentId: string, jobTitleId: string) =>
      data.departments.find((d) => d.departmentId === departmentId)?.jobs.find((j) => j.jobTitleId === jobTitleId)?.keys;

    // Somebody holds the ATM specialist's job in «العمليات»: the job is listed in it.
    const employee = await employeeIn(specialistJob);
    const res = await read();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const before = res.body.data as JobPapersDto;
    expect(before.papers[0]?.key).toBe(key('contract'));
    expect(before.papers.map((p) => p.key)).toEqual(expect.arrayContaining([...ALL_JOBS, key('weapon'), key('card.atm-specialist')]));
    const ops = before.departments.find((d) => d.departmentId === DEPARTMENT_ID);
    expect(ops?.name.ar).toBe('العمليات');
    // His papers as the templates tick them: the weapon declaration only offered, so not ticked.
    expect(lineOf(before, DEPARTMENT_ID, specialistJob)).toEqual([...ALL_JOBS, key('card.atm-specialist')]);
    // Every active job, to add one to a department.
    expect(before.jobs.find((j) => j.jobTitleId === crewLeaderJob)?.keys).toContain(key('weapon'));

    // In «العمليات» the ATM specialist gains the weapon declaration and the crew leader's card, and
    // loses the bank letter.
    const keys = [
      ...ALL_JOBS.filter((k) => k !== key('bank-letter')),
      key('weapon'),
      key('card.atm-specialist'),
      key('card.atm-crew-leader'),
    ];
    const saved = await save({ lines: [{ departmentId: DEPARTMENT_ID, jobTitleId: specialistJob, keys }] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(lineOf(saved.body.data as JobPapersDto, DEPARTMENT_ID, specialistJob)).toEqual(keys);

    // The employee's papers and their printed set follow what was saved for their department and job.
    const papers = (
      await request(app)
        .get(`/api/v1/hr/contracts/employee-papers/${employee.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
    ).body.data as EmployeePapersDto;
    expect(papers.papers.map((p) => p.key)).toEqual(keys);
    expect(papers.papers.every((p) => !p.optional)).toBe(true);
    expect(((await pack(employee.id)).body.data as HiringPackDto).documents.map((d) => d.key)).toEqual(keys);

    // A job added to a department nobody holds it in yet is listed there from now on.
    const added = await save({ lines: [{ departmentId: DEPARTMENT_ID, jobTitleId: crewLeaderJob, keys: [key('contract'), key('weapon')] }] });
    expect(lineOf(added.body.data as JobPapersDto, DEPARTMENT_ID, crewLeaderJob)).toEqual([key('contract'), key('weapon')]);

    // Saved again as it was: back to its templates' papers.
    const back = await save({ lines: [{ departmentId: DEPARTMENT_ID, jobTitleId: specialistJob, keys: lineOf(before, DEPARTMENT_ID, specialistJob) }] });
    expect(lineOf(back.body.data as JobPapersDto, DEPARTMENT_ID, specialistJob)).toEqual(lineOf(before, DEPARTMENT_ID, specialistJob));

    // An unpublished paper, an unknown department, an empty request and a user without the permission
    // are refused.
    const line = (over: object) => ({ lines: [{ departmentId: DEPARTMENT_ID, jobTitleId: specialistJob, keys, ...over }] });
    expect((await save(line({ keys: ['not.a.paper'] }))).status).toBe(400);
    expect((await save(line({ departmentId: '64b1f0cccccccccccccccc0e' }))).status).toBe(404);
    expect((await save({ lines: [] })).status).toBe(400);
    expect((await read(aliceToken)).status).toBe(403);
    expect((await save(line({}), aliceToken)).status).toBe(403);
  });

  it('«مسميات الوظائف لدى التأمينات»: form 1 prints the job as social insurance names it, else its own (A28)', async () => {
    const read = async (token = adminToken) =>
      request(app).get('/api/v1/hr/contracts/insurance-job-titles').set('Authorization', `Bearer ${token}`);
    const save = async (body: object, token = adminToken) =>
      request(app).patch('/api/v1/hr/contracts/insurance-job-titles').set('Authorization', `Bearer ${token}`).send(body);
    const titleOf = (data: InsuranceJobTitlesDto) => data.jobs.find((j) => j.jobTitleId === specialistJob)?.insuranceTitle;

    const res = await read();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const before = res.body.data as InsuranceJobTitlesDto;
    expect(before.jobs.find((j) => j.jobTitleId === specialistJob)).toMatchObject({ code: 'JT-PAPER-1', insuranceTitle: '' });

    const saved = await save({ titles: [{ jobTitleId: specialistJob, insuranceTitle: '  فني صيانة ماكينات ' }] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(titleOf(saved.body.data as InsuranceJobTitlesDto)).toBe('فني صيانة ماكينات');
    // Form 1 alone prints it — the contract keeps the company's own name for the job.
    const employee = await employeeIn(specialistJob);
    const html = ((await pack(employee.id)).body.data as HiringPackDto).html;
    expect(html).toContain('فني صيانة ماكينات');
    expect(html).toContain('بوظيفة ( أخصائى صراف آلى )');

    // Emptied: form 1 prints the job's own name again.
    const cleared = await save({ titles: [{ jobTitleId: specialistJob, insuranceTitle: '' }] });
    expect(titleOf(cleared.body.data as InsuranceJobTitlesDto)).toBe('');
    const later = await employeeIn(specialistJob);
    expect(((await pack(later.id)).body.data as HiringPackDto).html).not.toContain('فني صيانة ماكينات');

    // Too long, an unknown job, an empty request and a user without the permission are refused.
    expect((await save({ titles: [{ jobTitleId: specialistJob, insuranceTitle: 'م'.repeat(151) }] })).status).toBe(400);
    expect((await save({ titles: [{ jobTitleId: '64b1f0cccccccccccccccc0e', insuranceTitle: 'أي' }] })).status).toBe(404);
    expect((await save({ titles: [] })).status).toBe(400);
    expect((await read(aliceToken)).status).toBe(403);
    expect((await save({ titles: [{ jobTitleId: specialistJob, insuranceTitle: 'أي' }] }, aliceToken)).status).toBe(403);
  });
});
