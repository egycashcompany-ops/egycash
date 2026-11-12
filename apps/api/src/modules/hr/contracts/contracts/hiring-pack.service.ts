// «مستندات التعيين» — everything one employee signs on joining, printed in one go (A27).
//
// «عاوز يجبلي كل الحاجه اللي هتتطبع للشخص دا علي حسب وظيفتو … سواق كانت من العقد او نمازج التعيين
// الخاصة بيه». The set is the employee's CONTRACT first, then every PUBLISHED form whose jobs
// include the employee's job (or that is for every job), in each form's print order.
//
// THE CONTRACT IS THE REAL ONE. When the employee already has a generated contract, its pinned
// template version and its FROZEN variables are printed — the same content as its snapshot (A21),
// never a fresh resolution against data that has moved since. When there is none, the set makes
// one, the way HR would by hand: from the contract template of the employee's job, starting on the
// employment's start date, for one year when the type is fixed-term («اه بس على حسب وظيفته») —
// through the ordinary create and generate, so numbering, approval and every A16 check apply.
// Whatever stops that (no template for the job, approval required, a required value missing, a
// caller who may not create contracts) is reported beside the set, and the forms still print.
//
// A FORM IS NOT A CONTRACT. It is rendered fresh each time, keeps no snapshot and fails nothing:
// a value the record lacks prints as a dotted line to fill in by hand.
import {
  ErrorCodes,
  type ContractOverride,
  type EmployeePapersDto,
  type HiringPackContractNote,
  type HiringPackDto,
} from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import { hasPermission, type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { jobTitleService } from '../../../../platform/organization';
import { addDays, dateOnlyIso } from '../../shared/business-date';
import { employeeService } from '../../employee-management/employees';
import { type EmployeeDoc } from '../../employee-management/employees/employee.model';
import { contractBrandingService } from '../branding';
import { contractTypeService } from '../contract-types';
import { contractTemplateService } from '../contract-templates';
import { optionalForJob } from '../hiring-templates';
import { printSettings, type ContractTemplateDoc } from '../contract-templates/contract-template.model';
import { resolveContractVariables } from './contract-variables';
import { renderHiringPackHtml, type HiringPackPart } from './contract-render';
import { letterheadFor } from './letterhead';
import { contractService } from './contract.service';
import { type ContractDoc } from './contract.model';
import { type JobPaperOverride } from '../job-papers/job-papers.model';
import { jobPapersRepository } from '../job-papers/job-papers.repository';

/** A28 — the term and typed-in values a candidate's contract is made with at the hire. */
export interface ContractTerms {
  startDate: string;
  endDate: string | null;
  overrides: ContractOverride[];
}

/** A generated contract that is still the employee's: printable as it stands. */
const PRINTABLE = new Set(['active', 'signed']);
/** A contract on its way: the set finishes it when it may, or says why it cannot. */
const IN_PROGRESS = new Set(['draft', 'pendingApproval', 'approved']);

/** Does this template print for `jobTitleId`? */
export const appliesToJob = (template: ContractTemplateDoc, jobTitleId: string): boolean => {
  const settings = printSettings(template);
  return settings.allJobs || settings.jobTitleIds.some((id) => String(id) === jobTitleId);
};

/**
 * The published templates an employee's job prints, contracts and forms, in print order: those its
 * templates give it, as «مستندات الوظائف» changed them (`override`) — added to, or taken off.
 */
export const templatesForJob = (
  published: readonly ContractTemplateDoc[],
  jobTitleId: string,
  override: JobPaperOverride | null = null,
): { contracts: ContractTemplateDoc[]; forms: ContractTemplateDoc[] } => {
  const added = new Set(override?.added ?? []);
  const removed = new Set(override?.removed ?? []);
  const mine = published
    .filter(
      (template) =>
        added.has(template.key) || (appliesToJob(template, jobTitleId) && !removed.has(template.key)),
    )
    .sort(
      (a, b) =>
        printSettings(a).printOrder - printSettings(b).printOrder || a.name.ar.localeCompare(b.name.ar, 'ar'),
    );
  return {
    contracts: mine.filter((template) => printSettings(template).kind === 'contract'),
    forms: mine.filter((template) => printSettings(template).kind === 'form'),
  };
};

/** One year from `start`, the day before its anniversary: 15/11/2026 → 14/11/2027. */
export const oneYearFrom = (start: Date): Date => {
  const next = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()));
  return addDays(next, -1);
};

class HiringPackService {
  /**
   * The employee's contract for the set: one already generated, or one this request finishes or
   * makes. Never throws for a reason the HR clerk can act on — it reports it as the note.
   */
  private async contractFor(
    ctx: AuthContext,
    employee: EmployeeDoc,
    contractTemplates: readonly ContractTemplateDoc[],
    scope: ScopeSelector,
    /** A28 — the term and values the candidate's papers were printed with; else the employment's. */
    terms: ContractTerms | null = null,
  ): Promise<{ doc: ContractDoc | null; created: boolean; note: HiringPackContractNote | null }> {
    const id = String(employee._id);
    const contracts = await contractService.listForEmployee(id);
    const printable = contracts.find((c) => PRINTABLE.has(c.status) && c.renderedHtml !== null);
    if (printable !== undefined) return { doc: printable, created: false, note: null };

    const mayMake = hasPermission(ctx, 'contract.create') && hasPermission(ctx, 'contract.generate');
    let pending = contracts.find((c) => IN_PROGRESS.has(c.status)) ?? null;
    let created = false;
    if (pending === null) {
      const template = contractTemplates[0];
      if (template === undefined || template.contractTypeId === null) {
        return { doc: null, created: false, note: 'noTemplate' };
      }
      if (!mayMake) return { doc: null, created: false, note: 'notPermitted' };
      const type = await contractTypeService.getById(String(template.contractTypeId));
      const start = employee.employment.startDate;
      try {
        pending = await contractService.createDraft(
          ctx,
          {
            employeeId: id,
            typeId: String(template.contractTypeId),
            templateId: String(template._id),
            startDate: terms?.startDate ?? dateOnlyIso(start),
            endDate: type.allowsEndDate ? (terms === null ? dateOnlyIso(oneYearFrom(start)) : terms.endDate) : null,
            referenceNumber: null,
            // Only what the contract prints: an override of a form's value is no contract's business.
            overrides: (terms?.overrides ?? []).filter((o) => template.placeholders.includes(o.key)),
          },
          scope,
        );
        created = true;
      } catch (error) {
        if (error instanceof AppError && error.httpStatus < 500) {
          return { doc: null, created: false, note: 'notCreated' };
        }
        throw error;
      }
    }

    if (!mayMake) return { doc: null, created, note: 'notPermitted' };
    const needsApproval = pending.approval !== null && pending.status !== 'approved';
    if (needsApproval) return { doc: null, created, note: 'approvalRequired' };
    try {
      const generated = await contractService.generate(ctx, String(pending._id), pending.__v, scope);
      return { doc: generated, created, note: null };
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCodes.CONTRACT_VARIABLES_MISSING) {
        return { doc: null, created, note: 'missingValues' };
      }
      if (error instanceof AppError && error.httpStatus < 500) {
        return { doc: null, created, note: 'notCreated' };
      }
      throw error;
    }
  }

  /**
   * A28 — the contract of a candidate just hired from «عقد جديد»: made and generated from the
   * contract template of the job, with the term and values the papers were printed with. Whatever
   * stops that is returned as the note, as the printed set returns it; the hire stands regardless.
   */
  async contractForHire(
    ctx: AuthContext,
    employeeId: string,
    scope: ScopeSelector,
    terms: ContractTerms,
  ): Promise<{ doc: ContractDoc | null; note: HiringPackContractNote | null }> {
    const employee = await employeeService.getById(employeeId, scope);
    const jobTitleId = String(employee.employment.jobTitleId);
    const { contracts } = templatesForJob(
      await contractTemplateService.listPublished(),
      jobTitleId,
      await jobPapersRepository.overrideOf(jobTitleId),
    );
    const made = await this.contractFor(ctx, employee, contracts, scope, terms);
    return { doc: made.doc, note: made.note };
  }

  /**
   * The contract an employee holds now — a generated one still theirs, else one on its way — and
   * the template key it prints from: the paper «العقد» stands for on their tab.
   */
  private async heldContract(
    employeeId: string,
    contractTemplates: readonly ContractTemplateDoc[],
  ): Promise<{ held: ContractDoc | null; key: string | null }> {
    const contracts = await contractService.listForEmployee(employeeId);
    const held =
      contracts.find((c) => PRINTABLE.has(c.status) && c.renderedHtml !== null) ??
      contracts.find((c) => IN_PROGRESS.has(c.status)) ??
      null;
    return { held, key: held?.templateKey ?? contractTemplates[0]?.key ?? null };
  }

  /**
   * A28 — the employee's «طباعة العقد والمستندات» tab: their job's papers (their contract first,
   * then the forms every job signs, then their job's own) and the contract they hold.
   */
  async papersFor(employeeId: string, scope: ScopeSelector): Promise<EmployeePapersDto> {
    const employee = await employeeService.getById(employeeId, scope);
    const jobTitleId = String(employee.employment.jobTitleId);
    const override = await jobPapersRepository.overrideOf(jobTitleId);
    const { contracts, forms } = templatesForJob(await contractTemplateService.listPublished(), jobTitleId, override);
    const job = await jobTitleService.getById(jobTitleId).catch(() => null);
    const { held, key } = await this.heldContract(employeeId, contracts);
    const papers: EmployeePapersDto['papers'] = [];
    if (key !== null) {
      const template = (await contractTemplateService.publishedOf(key)) ?? contracts[0] ?? null;
      papers.push({
        key,
        name: template?.name ?? { ar: 'العقد', en: 'Contract' },
        kind: 'contract',
        group: 'contract',
        optional: false,
      });
    }
    for (const form of forms) {
      papers.push({
        key: form.key,
        name: form.name,
        kind: 'form',
        group: printSettings(form).allJobs ? 'everyJob' : 'thisJob',
        // A job «مستندات الوظائف» changed prints exactly what was ticked there.
        optional: override === null && optionalForJob(form.key, job?.name.ar ?? null),
      });
    }
    return {
      papers,
      contract:
        held === null
          ? null
          : {
              id: String(held._id),
              code: held.code,
              status: held.status,
              startDate: dateOnlyIso(held.startDate),
              endDate: held.endDate === null ? null : dateOnlyIso(held.endDate),
              version: held.__v,
            },
    };
  }

  async build(
    ctx: AuthContext,
    employeeId: string,
    scope: ScopeSelector,
    /** A28 — only these papers (template keys); absent, the whole set. */
    keys?: readonly string[],
  ): Promise<HiringPackDto> {
    const employee = await employeeService.getById(employeeId, scope);
    const jobTitleId = String(employee.employment.jobTitleId);
    const published = templatesForJob(
      await contractTemplateService.listPublished(),
      jobTitleId,
      await jobPapersRepository.overrideOf(jobTitleId),
    );
    const wanted = keys === undefined ? null : new Set(keys);
    const contracts = published.contracts;
    const forms = published.forms.filter((form) => wanted === null || wanted.has(form.key));
    const contractKey = wanted === null ? null : (await this.heldContract(employeeId, contracts)).key;
    const withContract = wanted === null || (contractKey !== null && wanted.has(contractKey));

    const parts: HiringPackPart[] = [];
    const documents: HiringPackDto['documents'] = [];
    const contract = withContract
      ? await this.contractFor(ctx, employee, contracts, scope)
      : { doc: null, created: false, note: null };
    if (contract.doc !== null && contract.doc.pinnedTemplateVersion !== null) {
      const pinned = await contractTemplateService.pinnedVersion(
        contract.doc.templateKey,
        contract.doc.pinnedTemplateVersion,
      );
      parts.push({
        kind: 'contract',
        template: pinned,
        values: contract.doc.variables,
        options: { branding: await contractBrandingService.resolveRenderBranding(ctx, pinned.language) },
      });
      documents.push({ key: pinned.key, name: pinned.name, kind: 'contract' });
    }

    for (const form of forms) {
      // A form fails nothing: whatever is missing prints as a line to fill in by hand.
      const { values } = await resolveContractVariables(form.placeholders, {
        employee,
        code: contract.doc?.code ?? '',
        startDate: dateOnlyIso(employee.employment.startDate),
        endDate: null,
        language: form.language,
        overrides: {},
        overriddenBy: null,
      });
      parts.push({ kind: 'form', template: form, values });
      documents.push({ key: form.key, name: form.name, kind: 'form' });
    }

    const language = parts[0]?.template.language ?? 'ar';
    const html = renderHiringPackHtml(parts, language, await letterheadFor(language));
    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'employee', entityId: employeeId },
      action: 'export',
      changes: [
        { field: 'format', old: null, new: 'hiringPack' },
        { field: 'documents', old: null, new: documents.map((d) => d.key).join(',') },
      ],
      actor: { userId: ctx.userId, ip: null, userAgent: null },
    });
    return {
      html,
      contract:
        contract.doc === null
          ? null
          : { id: String(contract.doc._id), code: contract.doc.code, created: contract.created },
      contractNote: contract.note,
      documents,
    };
  }
}

export const hiringPackService = new HiringPackService();
