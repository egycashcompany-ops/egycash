// A28 — «عقد جديد» for a CANDIDATE: print everything an accepted candidate signs, then hire.
//
// «هنستبدل زرار التعيين بزرار اسمو طباعه العقد و المستندات … و زرار جمبو علطول اللي هو التعيين …
// الزرار ميبقاش active الا لما يطبع اول». The candidate is not an employee yet, so the papers print
// from the employee the offer WOULD make (`employeeService.candidateFromOffer`): the offer's terms
// and the applicant's personal data, exactly as the hire will copy them.
//
//   · THE PAPERS are the job's: its contract template first, then the forms every job signs, then
//     the forms of this job only — the same published templates the employee's printed set uses.
//   · «تعديل» types a value in for this candidate (an address, a date…). It is kept here and used
//     by every paper that prints it; no template changes.
//   · THE FIRST PRINT keeps the next employee code for the candidate, so the bank letter carries the
//     code the hire will give. A candidate never hired leaves that number unused.
//   · THE HIRE is refused until the papers were printed. It makes the employee with the kept code,
//     then the contract — made and generated from the job's contract template with the term and
//     values the papers were printed with. Whatever stops the contract is returned as a note; the
//     hire stands.
//   · Everything the page changes is saved as it changes («يتعملو ريكورد»): a closed tab or an
//     expired session resumes where it stopped.
//   · MANY AT ONCE («طباعة لكل المحدد» on «جاهزون للتعيين»): the people ticked, the papers chosen
//     once for all; each person prints those of them their own job has, all in one document, each
//     print recorded as a single person's is.
import { Types } from 'mongoose';
import {
  type CandidateBulkPersonDto,
  type CandidateDraftDto,
  type CandidatePaperDto,
  type HireCandidate,
  type HireCandidateDto,
  type RenderCandidateBulk,
  type RenderCandidateBulkDto,
  type RenderCandidatePapers,
  type RenderCandidatePapersDto,
  type UpdateCandidateDraft,
} from '@ecms/contracts';
import { AppError, BusinessRuleError, ConflictError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { jobTitleService } from '../../../../platform/organization';
import { dateOnlyIso } from '../../shared/business-date';
import { employeeService } from '../../employee-management/employees';
import { type EmployeeDoc } from '../../employee-management/employees/employee.model';
import { contractBrandingService } from '../branding';
import { contractTypeService } from '../contract-types';
import { contractTemplateService } from '../contract-templates';
import { printSettings, type ContractTemplateDoc } from '../contract-templates/contract-template.model';
import { renderHiringPackHtml, type HiringPackPart } from '../contracts/contract-render';
import { resolveContractVariables } from '../contracts/contract-variables';
import { hiringPackService, oneYearFrom, templatesForJob } from '../contracts/hiring-pack.service';
import { letterheadFor } from '../contracts/letterhead';
import { CONTRACT_VARIABLE_CATALOG } from '../shared/variable-catalog';
import { candidateDraftRepository } from './candidate-draft.repository';
import { type CandidateDraftDoc } from './candidate-draft.model';

/** Values the papers print that are never typed in for a candidate. */
const NOT_TYPED = new Set(['employee.employeeCode']);

const offerRef = (offerId: string) => ({ moduleId: 'hr', entityType: 'jobOffer', entityId: offerId });

/** A paper of the candidate's job, in print order, with where it belongs on the page. */
interface Paper {
  template: ContractTemplateDoc;
  group: CandidatePaperDto['group'];
}

/** Everything the page is drawn from: the draft, the would-be employee, the job's papers. */
interface Context {
  draft: CandidateDraftDoc;
  employee: EmployeeDoc;
  offerCode: string | null;
  applicantName: string;
  hiredEmployeeId: string | null;
  papers: Paper[];
  allowsEndDate: boolean;
}

const dateOf = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** The job's papers: its contract (the first by print order), then every-job forms, then its own. */
export const papersOfJob = (published: readonly ContractTemplateDoc[], jobTitleId: string): Paper[] => {
  const { contracts, forms } = templatesForJob(published, jobTitleId);
  const contract = contracts[0];
  return [
    ...(contract === undefined ? [] : [{ template: contract, group: 'contract' as const }]),
    ...forms.map((template) => ({
      template,
      group: printSettings(template).allJobs ? ('everyJob' as const) : ('thisJob' as const),
    })),
  ];
};

class CandidateDraftService {
  /** The page's context; with `create`, the draft is made on the first visit, from the offer. */
  private async context(ctx: AuthContext, offerId: string, scope: ScopeSelector, create: boolean): Promise<Context> {
    let draft = await candidateDraftRepository.findByOffer(offerId);
    const candidate = await employeeService.candidateFromOffer(offerId, scope, {
      employeeNumber: draft?.employeeNumber ?? null,
      hiredAt: draft === null ? new Date() : dateOf(draft.hiringDate),
    });
    const { employee } = candidate;
    const papers = papersOfJob(
      await contractTemplateService.listPublished(),
      String(employee.employment.jobTitleId),
    );
    const contract = papers.find((paper) => paper.group === 'contract');
    const allowsEndDate =
      contract?.template.contractTypeId == null
        ? false
        : (await contractTypeService.getById(String(contract.template.contractTypeId)).catch(() => null))
            ?.allowsEndDate ?? false;

    if (draft === null) {
      if (!create) throw new BusinessRuleError('the candidate\'s papers were never opened');
      const start = employee.employment.startDate;
      const startDate = dateOnlyIso(start);
      try {
        draft = await candidateDraftRepository.create(
          {
            offerId: new Types.ObjectId(offerId),
            selected: null,
            overrides: [],
            startDate,
            endDate: allowsEndDate ? dateOnlyIso(oneYearFrom(start)) : null,
            hiringDate: startDate,
            employeeNumber: null,
            printedAt: null,
            printedBy: null,
            printCount: 0,
            employeeId: null,
          },
          { by: ctx.userId },
        );
      } catch (error) {
        // Two tabs opening the same candidate at once: the other one's draft is this one's.
        const again = await candidateDraftRepository.findByOffer(offerId);
        if (again === null) throw error;
        draft = again;
      }
    }
    // The would-be employee is hired on the draft's hiring date.
    (employee as { hiredAt: Date }).hiredAt = dateOf(draft.hiringDate);
    return {
      draft,
      employee,
      offerCode: candidate.offerCode,
      applicantName: candidate.applicantName,
      hiredEmployeeId: candidate.hiredEmployeeId,
      papers,
      allowsEndDate,
    };
  }

  /** The values one set of placeholders prints for the candidate, typed-in values applied. */
  private async valuesFor(c: Context, placeholders: string[]) {
    return resolveContractVariables(placeholders, {
      employee: c.employee,
      code: '',
      startDate: c.draft.startDate,
      endDate: c.draft.endDate,
      language: 'ar',
      overrides: Object.fromEntries(c.draft.overrides.map((o) => [o.key, o.value])),
      overriddenBy: null,
    });
  }

  private async toDto(c: Context): Promise<CandidateDraftDto> {
    const { draft } = c;
    const keys = [...new Set(c.papers.flatMap((paper) => paper.template.placeholders))];
    const { values } = await this.valuesFor(c, keys);
    const job = await jobTitleService.getById(String(c.employee.employment.jobTitleId)).catch(() => null);
    const chosen = draft.selected === null ? null : new Set(draft.selected);
    return {
      id: String(draft._id),
      offerId: String(draft.offerId),
      offerCode: c.offerCode,
      applicantName: c.applicantName,
      jobTitle: job === null ? null : { ar: job.name.ar, en: job.name.en },
      startDate: draft.startDate,
      endDate: draft.endDate,
      hiringDate: draft.hiringDate,
      allowsEndDate: c.allowsEndDate,
      papers: c.papers.map(({ template, group }) => ({
        key: template.key,
        name: template.name,
        kind: printSettings(template).kind,
        group,
        placeholders: template.placeholders,
        selected: chosen === null || chosen.has(template.key),
      })),
      values: values.map((v) => {
        const entry = CONTRACT_VARIABLE_CATALOG.find((x) => x.key === v.key);
        return {
          key: v.key,
          label: entry?.label ?? { ar: v.key, en: v.key },
          value: v.value,
          overridden: v.source === 'override',
        };
      }),
      employeeCode: c.employee.code === '' ? null : c.employee.code,
      printedAt: draft.printedAt === null ? null : draft.printedAt.toISOString(),
      printCount: draft.printCount,
      employeeId:
        draft.employeeId !== null ? String(draft.employeeId) : c.hiredEmployeeId,
      updatedAt: draft.updatedAt.toISOString(),
      version: draft.__v,
    };
  }

  /** The candidate's page — opened, and its record made, on the first visit. */
  async open(ctx: AuthContext, offerId: string, scope: ScopeSelector): Promise<CandidateDraftDto> {
    return this.toDto(await this.context(ctx, offerId, scope, true));
  }

  /** Save what the page changed — the papers chosen, the values typed in, the dates. */
  async update(
    ctx: AuthContext,
    offerId: string,
    input: UpdateCandidateDraft,
    scope: ScopeSelector,
  ): Promise<CandidateDraftDto> {
    const c = await this.context(ctx, offerId, scope, false);
    const set: Partial<CandidateDraftDoc> = {};
    if (input.selected !== undefined) {
      const known = new Set(c.papers.map((paper) => paper.template.key));
      set.selected = input.selected.filter((key) => known.has(key));
    }
    if (input.overrides !== undefined) {
      // A blank value gives the record's own back; only what was typed is kept. The employee code
      // is never typed: it is the one kept at the first print, and the hire gives exactly that.
      set.overrides = input.overrides.filter((o) => o.value.trim() !== '' && !NOT_TYPED.has(o.key));
    }
    if (input.startDate !== undefined) set.startDate = input.startDate;
    if (input.endDate !== undefined) set.endDate = c.allowsEndDate ? input.endDate : null;
    if (input.hiringDate !== undefined) set.hiringDate = input.hiringDate;
    const end = set.endDate === undefined ? c.draft.endDate : set.endDate;
    const start = set.startDate ?? c.draft.startDate;
    if (end !== null && end < start) {
      throw new ValidationError([
        { field: 'body.endDate', code: 'INVALID', message: 'the contract cannot end before it starts' },
      ]);
    }
    const draft = await candidateDraftRepository.updateById(String(c.draft._id), set, {
      by: ctx.userId,
      version: input.version,
    });
    return this.open(ctx, String(draft.offerId), scope);
  }

  /**
   * The chosen papers as one document. A PREVIEW changes nothing. A PRINT keeps the employee code
   * for the candidate if none is kept yet, and records the print — what lets the hire through.
   */
  async render(
    ctx: AuthContext,
    offerId: string,
    input: RenderCandidatePapers,
    scope: ScopeSelector,
  ): Promise<RenderCandidatePapersDto> {
    let c = await this.context(ctx, offerId, scope, false);
    const wanted = new Set(input.keys);
    const papers = c.papers.filter((paper) => wanted.has(paper.template.key));
    if (papers.length !== wanted.size) {
      throw new ValidationError([
        { field: 'body.keys', code: 'INVALID', message: 'a paper that is not one of the job\'s papers' },
      ]);
    }
    if (input.print) c = await this.markPrinted(ctx, c, papers, scope);
    const html = renderHiringPackHtml(await this.partsFor(ctx, c, papers), 'ar', await letterheadFor('ar'));
    return { html, draft: await this.toDto(c) };
  }

  /** The rendered parts of `papers`, filled for the candidate. */
  private async partsFor(ctx: AuthContext, c: Context, papers: readonly Paper[]): Promise<HiringPackPart[]> {
    const rendered: HiringPackPart[] = [];
    for (const { template } of papers) {
      const { values } = await this.valuesFor(c, template.placeholders);
      if (printSettings(template).kind === 'contract') {
        rendered.push({
          kind: 'contract',
          template,
          values,
          options: { branding: await contractBrandingService.resolveRenderBranding(ctx, template.language) },
        });
      } else {
        rendered.push({ kind: 'form', template, values });
      }
    }
    return rendered;
  }

  /**
   * Record a print of `papers`: the employee code kept for the candidate if none is yet, the first
   * print's time and author, the count, and an audit entry on the offer. Returns the context as it
   * now is — the papers print the kept code.
   */
  private async markPrinted(ctx: AuthContext, c: Context, papers: readonly Paper[], scope: ScopeSelector): Promise<Context> {
    const offerId = String(c.draft.offerId);
    const employeeNumber = c.draft.employeeNumber ?? (await employeeService.reserveEmployeeNumber());
    await candidateDraftRepository.updateById(
      String(c.draft._id),
      {
        employeeNumber,
        printedAt: c.draft.printedAt ?? new Date(),
        printedBy: c.draft.printedBy ?? new Types.ObjectId(ctx.userId),
        printCount: c.draft.printCount + 1,
      },
      { by: ctx.userId, version: c.draft.__v },
    );
    await auditService.record({
      entityRef: offerRef(offerId),
      action: 'export',
      changes: [
        { field: 'format', old: null, new: 'candidatePapers' },
        { field: 'documents', old: null, new: papers.map((paper) => paper.template.key).join(',') },
      ],
      actor: { userId: ctx.userId, ip: null, userAgent: null },
    });
    return this.context(ctx, offerId, scope, false);
  }

  /**
   * «طباعة لكل المحدد» — each ticked person with the papers of their own job, opened (and their
   * record made) as one is when their page is opened. A person who cannot be printed for — the offer
   * no longer accepted, out of the caller's reach — is listed with why, not dropped.
   */
  async bulkOpen(ctx: AuthContext, offerIds: readonly string[], scope: ScopeSelector): Promise<CandidateBulkPersonDto[]> {
    const out: CandidateBulkPersonDto[] = [];
    for (const offerId of new Set(offerIds)) {
      try {
        const c = await this.context(ctx, offerId, scope, true);
        const job = await jobTitleService.getById(String(c.employee.employment.jobTitleId)).catch(() => null);
        out.push({
          offerId,
          applicantName: c.applicantName,
          offerCode: c.offerCode,
          jobTitle: job === null ? null : { ar: job.name.ar, en: job.name.en },
          papers: c.papers.map(({ template, group }) => ({
            key: template.key,
            name: template.name,
            kind: printSettings(template).kind,
            group,
          })),
          error: null,
        });
      } catch (error) {
        if (!(error instanceof AppError) || error.httpStatus >= 500) throw error;
        out.push({ offerId, applicantName: '', offerCode: null, jobTitle: null, papers: [], error: error.message });
      }
    }
    return out;
  }

  /**
   * Print the chosen papers for every ticked person, as ONE document: each person in turn, each
   * with those of the chosen papers their own job has, in print order — so a crew leader gets the
   * weapon declaration and every person their own job's card. Each print is recorded as a single
   * person's is (the code kept, the print counted and audited). A person with nothing to print, or
   * who cannot be printed for, is reported and skipped; the others print.
   */
  async bulkRender(ctx: AuthContext, input: RenderCandidateBulk, scope: ScopeSelector): Promise<RenderCandidateBulkDto> {
    const wanted = new Set(input.keys);
    const parts: HiringPackPart[] = [];
    const results: RenderCandidateBulkDto['results'] = [];
    for (const offerId of new Set(input.offerIds)) {
      try {
        let c = await this.context(ctx, offerId, scope, true);
        const papers = c.papers.filter((paper) => wanted.has(paper.template.key));
        if (papers.length === 0) {
          results.push({ offerId, printed: 0, error: 'none of the chosen papers is one of this job\'s papers' });
          continue;
        }
        c = await this.markPrinted(ctx, c, papers, scope);
        parts.push(...(await this.partsFor(ctx, c, papers)));
        results.push({ offerId, printed: papers.length, error: null });
      } catch (error) {
        if (!(error instanceof AppError) || error.httpStatus >= 500) throw error;
        results.push({ offerId, printed: 0, error: error.message });
      }
    }
    const html = parts.length === 0 ? '' : renderHiringPackHtml(parts, 'ar', await letterheadFor('ar'));
    return { html, results };
  }

  /** Hire the candidate — only once the papers were printed — and record the contract. */
  async hire(
    ctx: AuthContext,
    offerId: string,
    input: HireCandidate,
    scopes: { employee: ScopeSelector; contract: ScopeSelector },
  ): Promise<HireCandidateDto> {
    const c = await this.context(ctx, offerId, scopes.employee, false);
    const { draft } = c;
    if (draft.__v !== input.version) throw new ConflictError('the page is out of date — reopen it');
    if (draft.employeeId !== null || c.hiredEmployeeId !== null) {
      throw new ConflictError('this candidate is already hired');
    }
    if (draft.printedAt === null) {
      throw new BusinessRuleError('print the contract and the papers before the hire');
    }
    const { doc } = await employeeService.create(
      ctx,
      { jobOfferId: offerId, hiringDate: dateOf(draft.hiringDate) },
      scopes.employee,
      draft.employeeNumber === null ? {} : { employeeNumber: draft.employeeNumber },
    );
    await candidateDraftRepository.updateById(
      String(draft._id),
      { employeeId: doc._id },
      { by: ctx.userId, version: draft.__v },
    );
    const contract = await hiringPackService.contractForHire(ctx, String(doc._id), scopes.contract, {
      startDate: draft.startDate,
      endDate: draft.endDate,
      overrides: draft.overrides,
    });
    return {
      employeeId: String(doc._id),
      employeeCode: doc.code,
      contract: contract.doc === null ? null : { id: String(contract.doc._id), code: contract.doc.code },
      contractNote: contract.note,
    };
  }
}

export const candidateDraftService = new CandidateDraftService();
