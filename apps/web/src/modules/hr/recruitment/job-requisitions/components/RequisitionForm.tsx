// The requisition form — raise one, or edit one.
//
// THE FORM SAYS WHAT AN EDIT COSTS, BEFORE IT IS SAVED (D-REQ-15). Raising the quantity or moving
// the placement of an approved requisition sends it back to the manager step, and a person who
// learns that from a toast after saving has been surprised by their own system. The same rule the
// server enforces is computed here from the values on screen, purely to warn.
import { useState } from 'react';
import {
  MAX_PAGE_SIZE,
  type CreateJobRequisition,
  type JobRequisitionDto,
  type JobRequisitionPriority,
  type Locale,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import { useQuery } from '@tanstack/react-query';
import { useAppSelector } from '../../../../../store';
import { useT } from '../../../../../platform/localization/useT';
import { get } from '../../../../../shared/lib/api-client';
import { localized } from '../../../../../shared/lib/format';
import { useJobTitles } from '../../../../organization/job-titles/job-title-queries';

export interface RequisitionDraft {
  jobTitleId: string;
  departmentId: string;
  branchId: string;
  sectionId: string;
  quantity: number;
  reason: string;
  priority: JobRequisitionPriority;
  neededBy: string;
}

export const emptyDraft = (): RequisitionDraft => ({
  jobTitleId: '',
  departmentId: '',
  branchId: '',
  sectionId: '',
  quantity: 1,
  reason: '',
  priority: 'normal',
  neededBy: '',
});

export const draftFrom = (dto: JobRequisitionDto): RequisitionDraft => ({
  jobTitleId: dto.jobTitleId,
  departmentId: dto.departmentId,
  branchId: dto.branchId,
  sectionId: dto.sectionId ?? '',
  quantity: dto.quantity,
  reason: dto.reason,
  priority: dto.priority,
  neededBy: dto.neededBy === null ? '' : dto.neededBy.slice(0, 10),
});

/** The payload a create sends. An edit adds its `version` at the call site. */
export const toCreate = (draft: RequisitionDraft): CreateJobRequisition => ({
  jobTitleId: draft.jobTitleId,
  departmentId: draft.departmentId,
  branchId: draft.branchId,
  sectionId: draft.sectionId === '' ? null : draft.sectionId,
  quantity: draft.quantity,
  reason: draft.reason.trim(),
  priority: draft.priority,
  neededBy: draft.neededBy === '' ? null : new Date(draft.neededBy),
});

export const isComplete = (draft: RequisitionDraft): boolean =>
  draft.jobTitleId !== '' &&
  draft.departmentId !== '' &&
  draft.branchId !== '' &&
  draft.quantity >= 1 &&
  draft.reason.trim() !== '';

/**
 * Would saving this edit cost a fresh approval? The server's rule, mirrored to WARN only — it is
 * `job-requisition-rules.ts` that decides, and this never suppresses a save.
 */
export const wouldNeedReapproval = (
  before: JobRequisitionDto,
  draft: RequisitionDraft,
): boolean =>
  draft.quantity > before.quantity ||
  draft.jobTitleId !== before.jobTitleId ||
  draft.departmentId !== before.departmentId ||
  draft.branchId !== before.branchId ||
  (draft.sectionId === '' ? null : draft.sectionId) !== before.sectionId;

const orgOptions = (path: string): Promise<OrgUnitOptionDto[]> =>
  get<OrgUnitOptionDto[]>(`/platform/${path}/options`);

const PRIORITIES: readonly JobRequisitionPriority[] = ['low', 'normal', 'high', 'urgent'];

export const RequisitionForm = ({
  draft,
  onChange,
  existing,
}: {
  draft: RequisitionDraft;
  onChange: (next: RequisitionDraft) => void;
  existing: JobRequisitionDto | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [titleSearch, setTitleSearch] = useState('');

  const branches = useQuery({ queryKey: ['org', 'branches'], queryFn: () => orgOptions('branches') });
  const departments = useQuery({
    queryKey: ['org', 'departments'],
    queryFn: () => orgOptions('departments'),
  });
  const sections = useQuery({ queryKey: ['org', 'sections'], queryFn: () => orgOptions('sections') });
  const titles = useJobTitles({ pageSize: MAX_PAGE_SIZE, status: 'active', search: titleSearch });

  const set = <K extends keyof RequisitionDraft>(key: K, value: RequisitionDraft[K]): void =>
    onChange({ ...draft, [key]: value });

  const field = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';

  return (
    <div className="grid gap-4">
      <label className="grid gap-1 text-sm">
        <span className="font-medium">{t('hr.requisitions.form.jobTitle')}</span>
        <input
          className={field}
          placeholder={t('hr.requisitions.form.searchTitles')}
          value={titleSearch}
          onChange={(e) => setTitleSearch(e.target.value)}
        />
        <select
          className={field}
          value={draft.jobTitleId}
          onChange={(e) => set('jobTitleId', e.target.value)}
        >
          <option value="">{t('hr.requisitions.form.choose')}</option>
          {(titles.data?.items ?? []).map((title) => (
            <option key={title.id} value={title.id}>
              {localized(title.name, locale)}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t('hr.requisitions.form.department')}</span>
          <select
            className={field}
            value={draft.departmentId}
            onChange={(e) => set('departmentId', e.target.value)}
          >
            <option value="">{t('hr.requisitions.form.choose')}</option>
            {(departments.data ?? []).map((unit) => (
              <option key={unit.id} value={unit.id}>
                {localized(unit.name, locale)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t('hr.requisitions.form.branch')}</span>
          <select
            className={field}
            value={draft.branchId}
            onChange={(e) => set('branchId', e.target.value)}
          >
            <option value="">{t('hr.requisitions.form.choose')}</option>
            {(branches.data ?? []).map((unit) => (
              <option key={unit.id} value={unit.id}>
                {localized(unit.name, locale)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="grid gap-1 text-sm">
        <span className="font-medium">{t('hr.requisitions.form.section')}</span>
        <select
          className={field}
          value={draft.sectionId}
          onChange={(e) => set('sectionId', e.target.value)}
        >
          <option value="">{t('hr.requisitions.form.noSection')}</option>
          {(sections.data ?? []).map((unit) => (
            <option key={unit.id} value={unit.id}>
              {localized(unit.name, locale)}
            </option>
          ))}
        </select>
        {/* The list is every section; the server refuses one that belongs elsewhere, so say the
            rule here rather than letting a 422 be the first time anybody hears it. */}
        <span className="text-xs text-slate-500">{t('hr.requisitions.form.sectionHint')}</span>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t('hr.requisitions.form.quantity')}</span>
          <input
            type="number"
            min={1}
            max={999}
            className={field}
            value={draft.quantity}
            onChange={(e) => set('quantity', Number(e.target.value))}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t('hr.requisitions.form.priority')}</span>
          <select
            className={field}
            value={draft.priority}
            onChange={(e) => set('priority', e.target.value as JobRequisitionPriority)}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {t(`hr.requisitions.priority.${priority}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t('hr.requisitions.form.neededBy')}</span>
          <input
            type="date"
            className={field}
            value={draft.neededBy}
            onChange={(e) => set('neededBy', e.target.value)}
          />
        </label>
      </div>

      <label className="grid gap-1 text-sm">
        <span className="font-medium">{t('hr.requisitions.form.reason')}</span>
        <textarea
          className={field}
          rows={3}
          value={draft.reason}
          onChange={(e) => set('reason', e.target.value)}
        />
      </label>

      {existing !== null && wouldNeedReapproval(existing, draft) && existing.status !== 'draft' ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('hr.requisitions.form.reapprovalWarning')}
        </p>
      ) : null}
    </div>
  );
};
