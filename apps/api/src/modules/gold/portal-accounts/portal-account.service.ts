// Creating and administering the customer logins — the STAFF side of the portal.
//
// This service owns the RELATIONSHIP (which customer a login belongs to) and delegates every part
// of being an account to the platform: the platform creates the user, issues the setup link,
// hashes whatever password the customer later chooses, suspends, deletes, and keeps the audit
// trail. Nothing here re-implements any of that, which is the whole reason a portal account is an
// ECMS account rather than a second `portal_users` table.
//
// There is no password field anywhere in this file. Staff hand the customer a one-time setup link
// and the customer chooses their own password — the same flow every employee goes through.
import {
  type ChangeGoldPortalAccountStatus,
  type CreateGoldPortalAccount,
  type GoldPortalAccountCreatedDto,
  type GoldPortalAccountDto,
  type ListGoldPortalAccountsQuery,
  type Paginated,
  type UpdateGoldPortalAccount,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { rbacService } from '../../../platform/rbac';
import { userService } from '../../../platform/users';
import { type UserDoc } from '../../../platform/users/user.model';
import { userRepository } from '../../../platform/users/user.repository';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { goldCompanyRepository } from '../companies/company.repository';
import { GOLD_PORTAL_ROLE_KEY } from '../gold.seed';
import { GOLD_PORTAL_SUBJECT } from '../portal';

const entityRef = (id: string) => ({
  moduleId: 'gold',
  entityType: 'portalAccount',
  entityId: id,
});

const subjectOf = (doc: UserDoc): { moduleId: string; subjectType: string; subjectId: string } | null => {
  const subject = doc.externalSubject ?? null;
  if (subject === null) return null;
  return {
    moduleId: subject.moduleId,
    subjectType: subject.subjectType,
    subjectId: String(subject.subjectId),
  };
};

/** The filter that says "a gold portal account" — the only population this service administers. */
const PORTAL_ACCOUNT = {
  'externalSubject.moduleId': 'gold',
  'externalSubject.subjectType': GOLD_PORTAL_SUBJECT,
};

class GoldPortalAccountService {
  async list(query: ListGoldPortalAccountsQuery): Promise<Paginated<GoldPortalAccountDto>> {
    const filter: Record<string, unknown> = { ...PORTAL_ACCOUNT };
    if (query.companyId !== undefined) {
      filter['externalSubject.subjectId'] = new Types.ObjectId(query.companyId);
    }
    if (query.search !== undefined && query.search !== '') {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { username: pattern },
        { email: pattern },
        { 'profile.firstName.ar': pattern },
        { 'profile.lastName.ar': pattern },
      ];
    }
    const page = await userRepository.list({
      filter: filter as never,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'createdAt',
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'username'],
    });
    return { items: await this.decorate(page.items), meta: page.meta };
  }

  async getById(id: string): Promise<GoldPortalAccountDto> {
    const [dto] = await this.decorate([await this.portalUser(id)]);
    if (dto === undefined) throw new NotFoundError();
    return dto;
  }

  /**
   * A new customer login.
   *
   * Order matters: the company is proved real and live BEFORE an account exists, so a typo in the
   * company id cannot leave a stranded login nobody can reach. The role and the binding follow the
   * account, and both are idempotent, so a retry after a partial failure converges.
   */
  async create(input: CreateGoldPortalAccount, by: string): Promise<GoldPortalAccountCreatedDto> {
    const company = await goldCompanyRepository.findById(input.companyId);
    if (company === null) throw new NotFoundError();
    if (company.status !== 'active') {
      throw new BusinessRuleError('لا يمكن إنشاء حساب بوابة لجهة موقوفة');
    }

    const { user, activationToken } = await userService.create(
      {
        ...(input.email === undefined ? {} : { email: input.email }),
        username: input.username,
        firstName: input.firstName,
        lastName: input.lastName,
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        locale: 'ar',
        organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
      },
      by,
      {
        username: input.username,
        externalSubject: {
          moduleId: 'gold',
          subjectType: GOLD_PORTAL_SUBJECT,
          subjectId: input.companyId,
        },
      },
    );

    // Re-asserted rather than looked up: the seed creates it at boot, and calling the same
    // idempotent helper here means a deployment that somehow skipped the seed still converges
    // instead of failing on the first customer.
    const role = await rbacService.ensureManagedRole(
      GOLD_PORTAL_ROLE_KEY,
      { en: 'Gold portal customer', ar: 'عميل بوابة الذهب' },
      ['goldPortal.view'],
    );
    // `organization` scope, and it grants nothing wide: `goldPortal.view` is the account's ONLY
    // permission and every portal read is confined to their own company regardless of scope.
    await rbacService.ensureAssignment(String(user._id), String(role._id), 'organization');

    await auditService.record({
      entityRef: entityRef(String(user._id)),
      action: 'create',
      changes: diffChanges(
        {},
        { companyId: input.companyId, username: input.username, company: company.name },
      ),
    });

    const [dto] = await this.decorate([user]);
    if (dto === undefined) throw new NotFoundError();
    return { ...dto, activationToken };
  }

  /** Names, contact details, and — the one that matters — which customer the login belongs to. */
  async update(id: string, input: UpdateGoldPortalAccount, by: string): Promise<GoldPortalAccountDto> {
    const before = await this.portalUser(id);
    const beforeCompany = subjectOf(before)?.subjectId ?? null;

    if (input.companyId !== undefined && input.companyId !== beforeCompany) {
      const company = await goldCompanyRepository.findById(input.companyId);
      if (company === null) throw new NotFoundError();
      if (company.status !== 'active') {
        throw new BusinessRuleError('لا يمكن ربط الحساب بجهة موقوفة');
      }
      await userService.bindExternalSubject(id, {
        moduleId: 'gold',
        subjectType: GOLD_PORTAL_SUBJECT,
        subjectId: input.companyId,
      });
      await auditService.record({
        entityRef: entityRef(id),
        action: 'update',
        changes: diffChanges({ companyId: beforeCompany }, { companyId: input.companyId }),
      });
    }

    const profile: Record<string, unknown> = { version: input.version };
    if (input.firstName !== undefined) profile.firstName = input.firstName;
    if (input.lastName !== undefined) profile.lastName = input.lastName;
    if (input.email !== undefined) profile.email = input.email;
    if (input.phone !== undefined) profile.phone = input.phone;
    if (Object.keys(profile).length > 1) {
      await userService.update(id, profile as never, by);
    }
    return this.getById(id);
  }

  async changeStatus(
    id: string,
    input: ChangeGoldPortalAccountStatus,
    by: string,
  ): Promise<GoldPortalAccountDto> {
    await this.portalUser(id);
    await userService.changeStatus(id, { status: input.status, version: input.version }, by);
    return this.getById(id);
  }

  async remove(id: string, by: string): Promise<void> {
    await this.portalUser(id);
    await userService.softDelete(id, by);
    await auditService.record({ entityRef: entityRef(id), action: 'delete', changes: [] });
  }

  /** A fresh one-time setup link, for a customer who lost theirs or never used it. */
  async resendSetupLink(id: string): Promise<void> {
    await this.portalUser(id);
    await userService.resetViaSetupLink(id);
  }

  /**
   * Read a user and refuse unless it really is one of ours.
   *
   * This is the authorization boundary of the whole screen: `goldPortalAccount.*` grants authority
   * over CUSTOMER logins, and must never become a way to suspend an employee — or the super-admin —
   * by passing their id.
   */
  private async portalUser(id: string): Promise<UserDoc> {
    const doc = await userService.getById(id);
    const subject = subjectOf(doc);
    if (subject === null || subject.moduleId !== 'gold' || subject.subjectType !== GOLD_PORTAL_SUBJECT) {
      throw new NotFoundError();
    }
    return doc;
  }

  private async decorate(docs: UserDoc[]): Promise<GoldPortalAccountDto[]> {
    const companyIds = [
      ...new Set(docs.map((d) => subjectOf(d)?.subjectId).filter((v): v is string => v !== undefined)),
    ];
    const names = await goldCompanyRepository.namesOf(companyIds);
    return docs.map((doc) => {
      const dto = userService.toDto(doc);
      const companyId = subjectOf(doc)?.subjectId ?? '';
      return {
        id: dto.id,
        companyId,
        companyName: names.get(companyId) ?? null,
        fullName: `${dto.firstName.ar} ${dto.lastName.ar}`.trim(),
        username: dto.username,
        email: dto.email,
        phone: dto.phone,
        status: dto.status,
        accountStatus: dto.accountStatus,
        lastLoginAt: dto.lastLoginAt,
        version: dto.version,
      };
    });
  }
}

export const goldPortalAccountService = new GoldPortalAccountService();
