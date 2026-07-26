// The Contract lifecycle engine (frozen design D2/D3 + Revisions 1–2).
// draft → [approval gate A7] → generate (A13: sync freeze + async PDF) → active → signed
// → amended / renewed / terminated / expired → archived. The generated snapshot is
// immutable (A2/A3/A20); signed/archived contracts refuse every direct edit (A4).
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import {
  ErrorCodes,
  HrContractEvents,
  HrContractSettingKeys,
  HrContractTemplates,
  type AddContractAttachment,
  type AmendOrRenewContract,
  type ContractDto,
  type ContractPreviewDto,
  type CreateContract,
  type DecideContractApproval,
  type ListContractsQuery,
  type Paginated,
  type PreviewContract,
  type SignContractBlock,
  type TerminateContract,
  type UpdateContractDraft,
} from '@ecms/contracts';
import { BusinessRuleError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { settingsService } from '../../../../platform/settings';
import { notificationsService } from '../../../../platform/notifications';
import { emit } from '../../../../platform/kernel/event-bus';
import { employeeService } from '../../employee-management/employees';
import { contractTypeService } from '../contract-types';
import { contractTemplateService } from '../contract-templates';
import { DEFAULT_CONTRACT_NUMBER_FORMAT, nextContractNumber } from './contract-number';
import { resolveContractVariables } from './contract-variables';
import { renderContractHtml } from './contract-render';
import { contractRepository } from './contract.repository';
import { type ContractDoc } from './contract.model';

const GENERATOR_VERSION = 'ecms-api/2.1.0';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'contract', entityId: id });
const employeeRef = (id: string) => ({ moduleId: 'hr', entityType: 'employee', entityId: id });

const IMMUTABLE_STATUSES = new Set(['signed', 'archived']);
const dateOnly = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const isoOf = (d: Date | null): string | null => (d === null ? null : d.toISOString().slice(0, 10));

class ContractService {
  private async settings(): Promise<{ format: string; requireApproval: boolean; noticeDays: number }> {
    const subject = { userId: null, branchId: null };
    return {
      format:
        (await settingsService
          .resolve<string>(HrContractSettingKeys.NumberFormat, subject)
          .catch(() => DEFAULT_CONTRACT_NUMBER_FORMAT)) ?? DEFAULT_CONTRACT_NUMBER_FORMAT,
      requireApproval: await settingsService
        .resolve<boolean>(HrContractSettingKeys.RequireApproval, subject)
        .catch(() => true),
      noticeDays: await settingsService
        .resolve<number>(HrContractSettingKeys.ExpiryNoticeDays, subject)
        .catch(() => 30),
    };
  }

  /** A8 — every lifecycle event also lands on the EMPLOYEE timeline. */
  private async recordEmployeeActivity(doc: ContractDoc, messageKey: string): Promise<void> {
    await auditService.recordActivity({
      entityRef: employeeRef(String(doc.employeeId)),
      messageKey,
      params: { code: doc.code, contractVersion: String(doc.contractVersion) },
    });
  }

  private assertMutable(doc: ContractDoc): void {
    if (IMMUTABLE_STATUSES.has(doc.status)) {
      throw new BusinessRuleError(
        'a signed/archived contract is immutable — amend or renew instead',
        ErrorCodes.CONTRACT_IMMUTABLE,
      );
    }
  }

  // ── Draft ──────────────────────────────────────────────────────────────────

  async createDraft(ctx: AuthContext, input: CreateContract, scope: ScopeSelector): Promise<ContractDoc> {
    const employee = await employeeService.getById(input.employeeId, scope);
    const type = await contractTypeService.getById(input.typeId);
    if (type.status !== 'active') throw new BusinessRuleError('the contract type is archived');
    if (input.endDate !== null && !type.allowsEndDate) {
      throw new BusinessRuleError('this contract type does not allow an end date');
    }
    if (!type.multipleActiveAllowed) {
      const blocking = await contractRepository.findBlockingActive(input.employeeId, input.typeId);
      if (blocking !== null) {
        throw new BusinessRuleError(
          `employee already has a ${blocking.status} contract of this type (${blocking.code})`,
        );
      }
    }
    const template = await contractTemplateService.getById(input.templateId);
    const { format, requireApproval } = await this.settings();
    const code = await nextContractNumber(format, new Date().getUTCFullYear());

    const doc = await contractRepository.create(
      {
        code,
        referenceNumber: input.referenceNumber,
        employeeId: new Types.ObjectId(input.employeeId),
        employeeName: employee.personal.fullNameAr,
        employeeCode: employee.code,
        branchId: employee.employment.branchId,
        typeId: new Types.ObjectId(input.typeId),
        templateKey: template.key,
        templateId: new Types.ObjectId(input.templateId),
        pinnedTemplateVersion: null,
        templateLanguage: template.language,
        status: 'draft',
        contractVersion: 1,
        parentContractId: null,
        supersededById: null,
        startDate: dateOnly(input.startDate),
        endDate: input.endDate === null ? null : dateOnly(input.endDate),
        overrides: input.overrides,
        variables: [],
        renderedHtml: null,
        generation: { status: 'idle', error: null, requestedAt: null, completedAt: null, integrity: null, pdfFileId: null },
        signers: [],
        approval: requireApproval ? { required: true, steps: [] } : null,
        attachments: [],
        terminatedAt: null,
        terminatedBy: null,
        terminationReason: null,
        expiryNoticeSentAt: null,
      },
      { by: ctx.userId },
    );
    await auditService.record({ entityRef: entityRef(String(doc._id)), action: 'create' });
    await this.recordEmployeeActivity(doc, 'hr.contract.created');
    return doc;
  }

  async updateDraft(ctx: AuthContext, id: string, input: UpdateContractDraft, scope: ScopeSelector): Promise<ContractDoc> {
    const before = await contractRepository.getById(id, scope);
    this.assertMutable(before);
    if (before.status !== 'draft') throw new BusinessRuleError('only a draft contract can be edited');
    const set: Record<string, unknown> = {};
    if (input.typeId !== undefined) set.typeId = new Types.ObjectId(input.typeId);
    if (input.templateId !== undefined) {
      const template = await contractTemplateService.getById(input.templateId);
      set.templateId = new Types.ObjectId(input.templateId);
      set.templateKey = template.key;
      set.templateLanguage = template.language;
    }
    if (input.startDate !== undefined) set.startDate = dateOnly(input.startDate);
    if (input.endDate !== undefined) set.endDate = input.endDate === null ? null : dateOnly(input.endDate);
    if (input.referenceNumber !== undefined) set.referenceNumber = input.referenceNumber;
    if (input.overrides !== undefined) set.overrides = input.overrides;
    const after = await contractRepository.updateById(id, set, { by: ctx.userId, version: input.version });
    await auditService.record({ entityRef: entityRef(id), action: 'update' });
    return after;
  }

  async deleteDraft(ctx: AuthContext, id: string, scope: ScopeSelector): Promise<void> {
    const doc = await contractRepository.getById(id, scope);
    if (doc.status !== 'draft') throw new BusinessRuleError('only a draft contract can be deleted');
    await contractRepository.softDeleteById(id, { by: ctx.userId, scope });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  // ── Approval gate (A7 — workflow-shaped) ───────────────────────────────────

  async submitForApproval(ctx: AuthContext, id: string, version: number, scope: ScopeSelector): Promise<ContractDoc> {
    const doc = await contractRepository.getById(id, scope);
    if (doc.status !== 'draft') throw new BusinessRuleError('only a draft can be submitted');
    if (doc.approval === null) throw new BusinessRuleError('approval is not required — generate directly');
    const after = await contractRepository.updateById(id, { status: 'pendingApproval' }, { by: ctx.userId, version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: 'draft', new: 'pendingApproval' }],
    });
    await emit(HrContractEvents.ApprovalRequested, { contractId: id, code: doc.code });
    return after;
  }

  async decideApproval(ctx: AuthContext, id: string, input: DecideContractApproval, scope: ScopeSelector): Promise<ContractDoc> {
    const doc = await contractRepository.getById(id, scope);
    if (doc.status !== 'pendingApproval') throw new BusinessRuleError('the contract is not awaiting approval');
    const step = {
      step: (doc.approval?.steps.length ?? 0) + 1,
      decidedBy: new Types.ObjectId(ctx.userId),
      decision: input.decision,
      note: input.note ?? null,
      at: new Date(),
    };
    const after = await contractRepository.updateById(
      id,
      {
        status: input.decision === 'approved' ? 'approved' : 'draft',
        approval: { required: true, steps: [...(doc.approval?.steps ?? []), step] },
      },
      { by: ctx.userId, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: 'pendingApproval', new: after.status }],
    });
    await emit(HrContractEvents.ApprovalDecided, { contractId: id, code: doc.code, decision: input.decision });
    if (input.decision === 'approved') await this.recordEmployeeActivity(after, 'hr.contract.approved');
    return after;
  }

  // ── Generation (A13 sync freeze + async PDF) ───────────────────────────────

  async generate(ctx: AuthContext, id: string, version: number, scope: ScopeSelector): Promise<ContractDoc> {
    const doc = await contractRepository.getById(id, scope);
    this.assertMutable(doc);
    const approvalPending = doc.approval !== null && doc.status !== 'approved';
    if (doc.status !== 'draft' && doc.status !== 'approved') {
      throw new BusinessRuleError('the contract is already generated');
    }
    if (doc.status === 'draft' && approvalPending) {
      throw new BusinessRuleError('the contract requires approval before generation');
    }

    // A17 — pin the PUBLISHED version of the chosen template key.
    const pinned = await contractTemplateService.publishedVersionOf(String(doc.templateId));
    const employee = await employeeService.getById(String(doc.employeeId), scope);
    const overrides = doc.overrides ?? {};
    const { values, issues } = await resolveContractVariables(pinned.placeholders, {
      employee,
      code: doc.code,
      startDate: isoOf(doc.startDate) ?? '',
      endDate: isoOf(doc.endDate),
      language: pinned.language,
      overrides,
      overriddenBy: new Types.ObjectId(ctx.userId),
    });
    if (issues.length > 0) {
      // A16 — fail loud with the structured report in the message.
      throw new BusinessRuleError(
        `missing required values: ${issues.map((i) => i.placeholder).join(', ')}`,
        ErrorCodes.CONTRACT_VARIABLES_MISSING,
      );
    }

    const renderedHtml = renderContractHtml(pinned, values);
    const sha256 = createHash('sha256').update(renderedHtml).digest('hex');
    const now = new Date();
    const after = await contractRepository.updateById(
      id,
      {
        status: 'active',
        pinnedTemplateVersion: pinned.templateVersion,
        templateId: pinned._id,
        variables: values,
        renderedHtml,
        signers: pinned.signatures.map((block) => ({
          key: block.key,
          label: block.label,
          status: 'pending' as const,
          method: 'manual' as const,
          signedAt: null,
          recordedBy: null,
          evidenceFileId: null,
          note: null,
        })),
        generation: {
          status: 'queued',
          error: null,
          requestedAt: now,
          completedAt: null,
          integrity: {
            sha256,
            generatedAt: now,
            generatorVersion: GENERATOR_VERSION,
            templateVersion: pinned.templateVersion,
            contractVersion: doc.contractVersion,
          },
          pdfFileId: null,
        },
      },
      { by: ctx.userId, version },
    );

    // Supersede the predecessor in the amend/renew chain (D3/A4).
    if (doc.contractVersion > 1) {
      const chain = await contractRepository.listForEmployee(String(doc.employeeId));
      const predecessor = chain.find((c) => c.code === doc.code && c.contractVersion === doc.contractVersion - 1);
      if (predecessor !== undefined && !IMMUTABLE_STATUSES.has(predecessor.status)) {
        await contractRepository.systemSet(String(predecessor._id), {
          status: 'amended',
          supersededById: after._id,
        });
        await auditService.record({ entityRef: entityRef(String(predecessor._id)), action: 'contractAmended' });
      } else if (predecessor !== undefined) {
        await contractRepository.systemSet(String(predecessor._id), { supersededById: after._id });
      }
    } else if (doc.parentContractId !== null) {
      await contractRepository.systemSet(String(doc.parentContractId), {
        status: 'renewed',
        supersededById: after._id,
      });
      await auditService.record({ entityRef: entityRef(String(doc.parentContractId)), action: 'contractRenewed' });
    }

    await auditService.record({
      entityRef: entityRef(id),
      action: 'contractGenerated',
      changes: [
        { field: 'templateVersion', old: null, new: pinned.templateVersion },
        { field: 'sha256', old: null, new: sha256 },
      ],
    });
    await this.recordEmployeeActivity(after, 'hr.contract.generated');
    await emit(HrContractEvents.Generated, {
      contractId: id,
      code: after.code,
      employeeId: String(after.employeeId),
      contractVersion: after.contractVersion,
    });
    // Internal reliable hop → the worker renders the PDF from the STORED snapshot (D8/A11).
    await emit('hr.contract.renderRequested', { contractId: id }, { reliable: true });
    return after;
  }

  async retryPdf(ctx: AuthContext, id: string, version: number, scope: ScopeSelector): Promise<ContractDoc> {
    const doc = await contractRepository.getById(id, scope);
    if (doc.renderedHtml === null) throw new BusinessRuleError('the contract has no snapshot yet');
    if (doc.generation.status !== 'failed') throw new BusinessRuleError('PDF generation has not failed');
    const after = await contractRepository.updateById(
      id,
      { 'generation.status': 'queued', 'generation.error': null, 'generation.requestedAt': new Date() },
      { by: ctx.userId, version },
    );
    await emit('hr.contract.renderRequested', { contractId: id }, { reliable: true });
    return after;
  }

  // ── Signing (A5 — manual driver) ───────────────────────────────────────────

  async signBlock(ctx: AuthContext, id: string, input: SignContractBlock, scope: ScopeSelector): Promise<ContractDoc> {
    const doc = await contractRepository.getById(id, scope);
    if (doc.status !== 'active') throw new BusinessRuleError('only an active (generated) contract can be signed');
    const signers = doc.signers.map((s) =>
      s.key === input.key
        ? {
            ...s,
            status: 'signed' as const,
            signedAt: new Date(),
            recordedBy: new Types.ObjectId(ctx.userId),
            evidenceFileId: input.evidenceFileId === undefined ? null : new Types.ObjectId(input.evidenceFileId),
            note: input.note ?? null,
          }
        : s,
    );
    if (!doc.signers.some((s) => s.key === input.key)) throw new NotFoundError('signature block not found');
    const allSigned = signers.every((s) => s.status === 'signed');
    const after = await contractRepository.updateById(
      id,
      { signers, ...(allSigned ? { status: 'signed' } : {}) },
      { by: ctx.userId, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'contractSigned',
      changes: [{ field: 'block', old: null, new: input.key }],
    });
    if (allSigned) {
      await this.recordEmployeeActivity(after, 'hr.contract.signed');
      await emit(HrContractEvents.Signed, { contractId: id, code: doc.code });
    }
    return after;
  }

  // ── Amend / renew / terminate / archive (D3/A4) ────────────────────────────

  private async spawnVersion(
    ctx: AuthContext,
    source: ContractDoc,
    input: AmendOrRenewContract,
    mode: 'amend' | 'renew',
  ): Promise<ContractDoc> {
    const template =
      input.templateId === undefined
        ? await contractTemplateService.getById(String(source.templateId))
        : await contractTemplateService.getById(input.templateId);
    const { format } = await this.settings();
    const code = mode === 'amend' ? source.code : await nextContractNumber(format, new Date().getUTCFullYear());
    const doc = await contractRepository.create(
      {
        code,
        referenceNumber: source.referenceNumber,
        employeeId: source.employeeId,
        employeeName: source.employeeName,
        employeeCode: source.employeeCode,
        branchId: source.branchId,
        typeId: source.typeId,
        templateKey: template.key,
        templateId: template._id,
        pinnedTemplateVersion: null,
        templateLanguage: template.language,
        status: 'draft',
        contractVersion: mode === 'amend' ? source.contractVersion + 1 : 1,
        parentContractId: mode === 'renew' ? source._id : source.parentContractId,
        supersededById: null,
        startDate: dateOnly(input.startDate),
        endDate: input.endDate === null ? null : dateOnly(input.endDate),
        overrides: input.overrides,
        variables: [],
        renderedHtml: null,
        generation: { status: 'idle', error: null, requestedAt: null, completedAt: null, integrity: null, pdfFileId: null },
        signers: [],
        approval: (await this.settings()).requireApproval ? { required: true, steps: [] } : null,
        attachments: [],
        terminatedAt: null,
        terminatedBy: null,
        terminationReason: null,
        expiryNoticeSentAt: null,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: mode === 'amend' ? 'contractAmended' : 'contractRenewed',
      changes: [{ field: 'sourceContractId', old: null, new: String(source._id) }],
    });
    await this.recordEmployeeActivity(doc, mode === 'amend' ? 'hr.contract.amendDrafted' : 'hr.contract.renewDrafted');
    await emit(mode === 'amend' ? HrContractEvents.Amended : HrContractEvents.Renewed, {
      contractId: String(doc._id),
      sourceContractId: String(source._id),
      code: doc.code,
    });
    return doc;
  }

  async amend(ctx: AuthContext, id: string, input: AmendOrRenewContract, scope: ScopeSelector): Promise<ContractDoc> {
    const source = await contractRepository.getById(id, scope);
    if (!['active', 'signed'].includes(source.status)) {
      throw new BusinessRuleError('only an active or signed contract can be amended');
    }
    if (source.supersededById !== null) throw new BusinessRuleError('this version is already superseded');
    return this.spawnVersion(ctx, source, input, 'amend');
  }

  async renew(ctx: AuthContext, id: string, input: AmendOrRenewContract, scope: ScopeSelector): Promise<ContractDoc> {
    const source = await contractRepository.getById(id, scope);
    if (!['active', 'signed', 'expired'].includes(source.status)) {
      throw new BusinessRuleError('only an active, signed or expired contract can be renewed');
    }
    if (source.supersededById !== null) throw new BusinessRuleError('this contract is already superseded');
    return this.spawnVersion(ctx, source, input, 'renew');
  }

  async terminate(ctx: AuthContext, id: string, input: TerminateContract, scope: ScopeSelector): Promise<ContractDoc> {
    const doc = await contractRepository.getById(id, scope);
    if (!['active', 'signed'].includes(doc.status)) {
      throw new BusinessRuleError('only an active or signed contract can be terminated');
    }
    const after = await contractRepository.updateById(
      id,
      {
        status: 'terminated',
        terminatedAt: dateOnly(input.date),
        terminatedBy: new Types.ObjectId(ctx.userId),
        terminationReason: input.reason,
      },
      { by: ctx.userId, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: doc.status, new: 'terminated' }],
    });
    await this.recordEmployeeActivity(after, 'hr.contract.terminated');
    await emit(HrContractEvents.Terminated, { contractId: id, code: doc.code, reason: input.reason });
    return after;
  }

  async archive(ctx: AuthContext, id: string, version: number, scope: ScopeSelector): Promise<ContractDoc> {
    const doc = await contractRepository.getById(id, scope);
    if (!['amended', 'renewed', 'terminated', 'expired'].includes(doc.status)) {
      throw new BusinessRuleError('only a superseded, terminated or expired contract can be archived');
    }
    const after = await contractRepository.updateById(id, { status: 'archived' }, { by: ctx.userId, version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: doc.status, new: 'archived' }],
    });
    return after;
  }

  // ── Attachments (A6) ───────────────────────────────────────────────────────

  async addAttachment(ctx: AuthContext, id: string, input: AddContractAttachment, version: number, scope: ScopeSelector): Promise<ContractDoc> {
    const doc = await contractRepository.getById(id, scope);
    const attachment = {
      attachmentId: new Types.ObjectId(),
      fileId: new Types.ObjectId(input.fileId),
      category: input.category,
      label: input.label,
      addedBy: new Types.ObjectId(ctx.userId),
      addedAt: new Date(),
    };
    const after = await contractRepository.updateById(
      id,
      { attachments: [...doc.attachments, attachment] },
      { by: ctx.userId, version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'attachment', old: null, new: `${input.category}:${input.label}` }],
    });
    return after;
  }

  async removeAttachment(ctx: AuthContext, id: string, attachmentId: string, version: number, scope: ScopeSelector): Promise<ContractDoc> {
    const doc = await contractRepository.getById(id, scope);
    this.assertMutable(doc); // A6 — removal is blocked once signed/archived
    const after = await contractRepository.updateById(
      id,
      { attachments: doc.attachments.filter((a) => String(a.attachmentId) !== attachmentId) },
      { by: ctx.userId, version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'attachmentRemoved', old: attachmentId, new: null }],
    });
    return after;
  }

  // ── Preview (D6/A18) + reads ───────────────────────────────────────────────

  async preview(input: PreviewContract, scope: ScopeSelector): Promise<ContractPreviewDto> {
    const template = await contractTemplateService.getById(input.templateId);
    const employee = await employeeService.getById(input.employeeId, scope);
    const { values, issues } = await resolveContractVariables(template.placeholders, {
      employee,
      code: '—',
      startDate: input.startDate ?? '',
      endDate: input.endDate ?? null,
      language: template.language,
      overrides: input.overrides,
      overriddenBy: null,
    });
    return { html: renderContractHtml(template, values), issues };
  }

  /** The immutable snapshot (A20) — every export reads THIS, never a fresh render. */
  async documentHtml(ctx: AuthContext, id: string, scope: ScopeSelector): Promise<string> {
    const doc = await contractRepository.getById(id, scope);
    if (doc.renderedHtml === null) throw new NotFoundError('the contract has no generated document yet');
    await auditService.record({
      entityRef: entityRef(id),
      action: 'export',
      changes: [{ field: 'format', old: null, new: 'html' }],
      actor: { userId: ctx.userId, ip: null, userAgent: null },
    });
    return doc.renderedHtml;
  }

  async getById(id: string, scope: ScopeSelector): Promise<ContractDoc> {
    return contractRepository.getById(id, scope);
  }

  async list(query: ListContractsQuery, scope: ScopeSelector): Promise<Paginated<ContractDoc>> {
    return contractRepository.listPage(query, scope);
  }

  async listForEmployee(employeeId: string): Promise<ContractDoc[]> {
    return contractRepository.listForEmployee(employeeId);
  }

  // ── Sweeps (D11) ───────────────────────────────────────────────────────────

  async expireOverdue(): Promise<number> {
    const overdue = await contractRepository.findOverdue(new Date());
    for (const doc of overdue) {
      await contractRepository.systemSet(String(doc._id), { status: 'expired' });
      await auditService.record({
        entityRef: entityRef(String(doc._id)),
        action: 'statusChange',
        changes: [{ field: 'status', old: doc.status, new: 'expired' }],
      });
      await this.recordEmployeeActivity(doc, 'hr.contract.expired');
      await emit(HrContractEvents.Expired, { contractId: String(doc._id), code: doc.code });
    }
    return overdue.length;
  }

  async notifyExpiring(): Promise<number> {
    const { noticeDays } = await this.settings();
    const soon = await contractRepository.findExpiringSoon(noticeDays);
    for (const doc of soon) {
      await notificationsService
        .notify({
          template: HrContractTemplates.ExpiringSoon,
          to: { permission: 'contract.view', scope: 'organization' },
          data: { code: doc.code, employeeName: doc.employeeName, endDate: isoOf(doc.endDate) ?? '' },
          entityRef: entityRef(String(doc._id)),
        })
        .catch(() => undefined);
      await contractRepository.systemSet(String(doc._id), { expiryNoticeSentAt: new Date() });
    }
    return soon.length;
  }

  // ── DTO ────────────────────────────────────────────────────────────────────

  toDto(doc: ContractDoc): ContractDto {
    const raw = doc.overrides as unknown;
    const overrides = raw instanceof Map ? Object.fromEntries(raw as Map<string, string>) : ((raw ?? {}) as Record<string, string>);
    return {
      id: String(doc._id),
      code: doc.code,
      referenceNumber: doc.referenceNumber,
      employeeId: String(doc.employeeId),
      employeeName: doc.employeeName,
      employeeCode: doc.employeeCode,
      typeId: String(doc.typeId),
      typeName: { ar: '', en: '' }, // filled by the controller via the type catalog
      templateId: String(doc.templateId),
      pinnedTemplateVersion: doc.pinnedTemplateVersion,
      templateLanguage: doc.templateLanguage,
      status: doc.status,
      contractVersion: doc.contractVersion,
      parentContractId: doc.parentContractId === null ? null : String(doc.parentContractId),
      supersededById: doc.supersededById === null ? null : String(doc.supersededById),
      startDate: isoOf(doc.startDate) ?? '',
      endDate: isoOf(doc.endDate),
      variables: doc.variables.map((v) => ({
        key: v.key,
        value: v.value,
        source: v.source,
        overriddenBy: v.overriddenBy === null ? null : String(v.overriddenBy),
      })),
      overrides: overrides as Record<string, string>,
      generation: {
        status: doc.generation.status,
        error: doc.generation.error,
        requestedAt: doc.generation.requestedAt?.toISOString() ?? null,
        completedAt: doc.generation.completedAt?.toISOString() ?? null,
        integrity:
          doc.generation.integrity === null
            ? null
            : {
                sha256: doc.generation.integrity.sha256,
                generatedAt: doc.generation.integrity.generatedAt.toISOString(),
                generatorVersion: doc.generation.integrity.generatorVersion,
                templateVersion: doc.generation.integrity.templateVersion,
                contractVersion: doc.generation.integrity.contractVersion,
              },
        pdfFileId: doc.generation.pdfFileId === null ? null : String(doc.generation.pdfFileId),
      },
      signers: doc.signers.map((s) => ({
        key: s.key,
        label: s.label,
        status: s.status,
        method: s.method,
        signedAt: s.signedAt?.toISOString() ?? null,
        recordedBy: s.recordedBy === null ? null : String(s.recordedBy),
        evidenceFileId: s.evidenceFileId === null ? null : String(s.evidenceFileId),
        note: s.note,
      })),
      approval:
        doc.approval === null
          ? null
          : {
              required: doc.approval.required,
              steps: doc.approval.steps.map((s) => ({
                step: s.step,
                decidedBy: String(s.decidedBy),
                decision: s.decision,
                note: s.note,
                at: s.at.toISOString(),
              })),
            },
      attachments: doc.attachments.map((a) => ({
        id: String(a.attachmentId),
        fileId: String(a.fileId),
        category: a.category,
        label: a.label,
        addedBy: String(a.addedBy),
        addedAt: a.addedAt.toISOString(),
      })),
      terminatedAt: doc.terminatedAt?.toISOString() ?? null,
      terminatedBy: doc.terminatedBy === null ? null : String(doc.terminatedBy),
      terminationReason: doc.terminationReason,
      hasSnapshot: doc.renderedHtml !== null,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      version: doc.__v,
    };
  }
}

export const contractService = new ContractService();
