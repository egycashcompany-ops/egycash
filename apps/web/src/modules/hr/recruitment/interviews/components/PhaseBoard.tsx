// The Phases (Kanban) view of the recruitment pipeline, composed client-side from the existing
// per-stage endpoints: Waiting for Scheduling → each ACTIVE interview stage → each ACTIVE
// evaluation phase → Job Offer (applicants HR explicitly moved there). Cards show the
// Application Number only. Waiting + interview columns support multi-selection with bulk
// actions: schedule interviews for all selected at once, or move them to the Job Offer stage.
// Every bulk row goes through the real bulk endpoint so all server rules keep applying and one
// audit record covers the act (RW17).
//
// I7 — the board is a table in card clothing: it uses the SAME `useTableSelection` model and the
// SAME `BulkActionBar` as every recruitment list, so a selection behaves identically here.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { type EvaluationDto, type InterviewDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { useCan } from '../../../../../platform/rbac/Can';
import { Button } from '../../../../../shared/ui/Button';
import { BulkActionBar } from '../../../../../shared/ui/BulkActionBar';
import { useTableSelection } from '../../../../../shared/ui/useTableSelection';
import { StatusBadge, type Tone } from '../../../../../shared/ui/Badge';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { formatDate, localized } from '../../../../../shared/lib/format';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { listApplicants } from '../../applicants/api/applicant-api';
import { useBulkApplicants } from '../../applicants/api/applicant-queries';
import { useEvaluationPhases, useEvaluations } from '../../evaluations/api/evaluation-queries';
import { useInterviews, useInterviewStages } from '../api/interview-queries';
import { BulkScheduleDialog } from './BulkScheduleDialog';

interface BoardCard {
  applicantId: string;
  applicantCode: string;
  applicantName: string;
  /** Secondary line under the code (state / date). */
  meta: string | null;
  badge: { tone: Tone; label: string } | null;
  /** Row link target (interview / evaluation detail; applicant for waiting/offer columns). */
  href: string;
}

interface BoardColumn {
  id: string;
  title: string;
  cards: BoardCard[];
  /** Waiting + interview columns are selectable (bulk scheduling / bulk move). */
  selectable: boolean;
}

export const PhaseBoard = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const can = useCan();

  const stages = useInterviewStages();
  const phases = useEvaluationPhases();
  const interviews = useInterviews({ page: 1, pageSize: 100, sortBy: 'createdAt', sortDir: 'desc' });
  const evaluations = useEvaluations({ page: 1, pageSize: 100 });
  const moved = useQuery({
    queryKey: ['hr', 'applicants', 'board', 'movedToOffer'],
    queryFn: () => listApplicants({ movedToOffer: true, status: 'new', pageSize: 100 }),
    staleTime: 30_000,
    select: (page) => page.items,
  });
  // Rejected/withdrawn applicants must never surface on the board, even where the stage record
  // itself doesn't carry the rejection (e.g. a screening re-decision after interviews were passed).
  const excluded = useQuery({
    queryKey: ['hr', 'applicants', 'board', 'excluded'],
    queryFn: async () => {
      const [rejected, withdrawn] = await Promise.all([
        listApplicants({ status: 'rejected', pageSize: 100 }),
        listApplicants({ status: 'withdrawn', pageSize: 100 }),
      ]);
      return new Set([...rejected.items, ...withdrawn.items].map((a) => a.id));
    },
    staleTime: 30_000,
  });

  const [bulkSchedule, setBulkSchedule] = useState(false);
  const bulk = useBulkApplicants();

  const columns = useMemo<BoardColumn[]>(() => {
    const stageList = [...(stages.data ?? [])].sort((a, b) => a.order - b.order);
    const phaseList = [...(phases.data ?? [])].sort((a, b) => a.order - b.order);
    const gone = excluded.data ?? new Set<string>();
    const assigned = new Set<string>();

    // Job Offer column — applicants HR explicitly moved (eligibility is never automatic).
    const offerCards: BoardCard[] = (moved.data ?? []).map((a) => {
      assigned.add(a.id);
      return {
        applicantId: a.id,
        applicantCode: a.code,
        applicantName: a.fullNameAr,
        meta: a.movedToOfferAt === null ? null : formatDate(a.movedToOfferAt, locale),
        badge: null,
        href: `/applicants/${a.id}`,
      };
    });

    // Evaluation columns — each applicant sits at their LATEST phase (rejected ones left the pipeline).
    const evalCards = new Map<string, BoardCard[]>();
    const latestEval = new Map<string, EvaluationDto>();
    for (const ev of evaluations.data?.items ?? []) {
      const prev = latestEval.get(ev.applicantId);
      if (prev === undefined || ev.phaseOrder > prev.phaseOrder) latestEval.set(ev.applicantId, ev);
    }
    for (const ev of latestEval.values()) {
      if (assigned.has(ev.applicantId)) continue;
      if (ev.status === 'rejected' || gone.has(ev.applicantId)) {
        // Left the pipeline — claim the id so they don't resurface in an earlier column.
        assigned.add(ev.applicantId);
        continue;
      }
      assigned.add(ev.applicantId);
      const card: BoardCard = {
        applicantId: ev.applicantId,
        applicantCode: ev.applicantCode,
        applicantName: ev.applicantName,
        meta: null,
        badge:
          ev.status === 'approved'
            ? { tone: 'success', label: t('evaluations.status.approved') }
            : { tone: 'warning', label: t('evaluations.status.waiting') },
        href: `/evaluations/${ev.id}`,
      };
      const list = evalCards.get(ev.phaseId) ?? [];
      list.push(card);
      evalCards.set(ev.phaseId, list);
    }

    // Interview columns — each applicant sits at their LATEST non-cancelled round. A round whose
    // status is still `waiting` is a REAL row (I11), so it heads the waiting column rather than the
    // stage column: the board reads the same rows as the queues and can never disagree with them.
    const interviewCards = new Map<string, BoardCard[]>();
    const waitingCards: BoardCard[] = [];
    const latestInterview = new Map<string, InterviewDto>();
    for (const iv of interviews.data?.items ?? []) {
      if (iv.status === 'cancelled') continue;
      const prev = latestInterview.get(iv.applicantId);
      if (prev === undefined || iv.stageOrder > prev.stageOrder) latestInterview.set(iv.applicantId, iv);
    }
    for (const iv of latestInterview.values()) {
      if (assigned.has(iv.applicantId)) continue;
      if (iv.outcome === 'failed' || gone.has(iv.applicantId)) {
        assigned.add(iv.applicantId);
        continue;
      }
      assigned.add(iv.applicantId);
      const card: BoardCard = {
        applicantId: iv.applicantId,
        applicantCode: iv.applicantCode,
        applicantName: iv.applicantName,
        meta: iv.status === 'scheduled' ? formatDate(iv.scheduledAt, locale) : null,
        badge:
          iv.outcome === 'passed'
            ? { tone: 'success', label: t('interviews.board.passed') }
            : iv.status === 'waiting'
              ? null
              : { tone: 'info', label: t('interviews.board.scheduled') },
        href: `/interviews/${iv.id}`,
      };
      if (iv.status === 'waiting') {
        waitingCards.push(card);
        continue;
      }
      const list = interviewCards.get(iv.stageId) ?? [];
      list.push(card);
      interviewCards.set(iv.stageId, list);
    }

    return [
      { id: 'waiting', title: t('interviews.board.waiting'), cards: waitingCards, selectable: true },
      ...stageList.map((s) => ({
        id: `stage-${s.id}`,
        title: localized(s.name, locale),
        cards: interviewCards.get(s.id) ?? [],
        selectable: true,
      })),
      ...phaseList.map((p) => ({
        id: `phase-${p.id}`,
        title: localized(p.name, locale),
        cards: evalCards.get(p.id) ?? [],
        selectable: false,
      })),
      { id: 'offer', title: t('interviews.board.offer'), cards: offerCards, selectable: false },
    ];
  }, [stages.data, phases.data, interviews.data, evaluations.data, moved.data, excluded.data, locale, t]);

  // I7 — one selection model. Selectable columns are the board's "rows on screen", so a card that
  // leaves the board (scheduled, moved, rejected) drops out of the selection by itself.
  const selectableIds = useMemo(
    () => columns.filter((c) => c.selectable).flatMap((c) => c.cards.map((card) => card.applicantId)),
    [columns],
  );
  const selection = useTableSelection(selectableIds);

  const loading =
    stages.isLoading ||
    phases.isLoading ||
    interviews.isLoading ||
    evaluations.isLoading ||
    excluded.isLoading;
  if (loading) return <LoadingState />;

  // RW17 — ONE request for the whole selection: the server runs each item in its own transaction
  // and answers with the partial-success envelope, so a per-row loop here would only invent a
  // second, weaker version of a rule the endpoint already enforces.
  const bulkMove = async (): Promise<void> => {
    try {
      const result = await bulk.mutateAsync({ action: 'moveToOffer', ids: selection.ids });
      if (result.failed === 0) toast.success(t('interviews.bulk.movedAll', { count: result.succeeded }));
      else toast.error(t('interviews.bulk.movedSome', { ok: result.succeeded, failed: result.failed }));
      selection.clear();
    } catch {
      // The global mutation error handler surfaces the failure.
    }
  };

  const canSchedule = can('interview.create');
  const canMove = can('applicant.moveToOffer');

  return (
    <div className="space-y-4">
      {(canSchedule || canMove) && (
        <BulkActionBar count={selection.count} onClear={selection.clear}>
          {canSchedule && (
            <Button size="sm" variant="secondary" onClick={() => setBulkSchedule(true)}>
              {t('interviews.bulk.schedule')}
            </Button>
          )}
          {canMove && (
            <Button size="sm" variant="secondary" loading={bulk.isPending} onClick={() => void bulkMove()}>
              {t('interviews.bulk.moveToOffer')}
            </Button>
          )}
        </BulkActionBar>
      )}

      <div className="overflow-x-auto pb-2">
        <div className="flex items-start gap-4" style={{ minWidth: 'max-content' }}>
          {columns.map((col) => (
            <section
              key={col.id}
              className="w-64 shrink-0 rounded-xl border border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/40"
            >
              <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-700">
                <h3 className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{col.title}</h3>
                <span className="ms-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  {col.cards.length}
                </span>
              </header>
              <div className="max-h-[60vh] space-y-2 overflow-y-auto p-2">
                {col.cards.length === 0 ? (
                  <p className="px-1 py-3 text-center text-xs text-slate-400">{t('interviews.board.empty')}</p>
                ) : (
                  col.cards.map((card) => (
                    <div
                      key={card.applicantId}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-800"
                    >
                      {col.selectable && (canSchedule || canMove) && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          checked={selection.selectedIds.has(card.applicantId)}
                          onChange={() => selection.toggleRow(card.applicantId)}
                          aria-label={card.applicantName}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => navigate(card.href)}
                        className="min-w-0 flex-1 text-start"
                      >
                        <p className="truncate text-xs text-slate-700 dark:text-slate-200">
                          {card.applicantName}
                        </p>
                        {card.meta !== null && <p className="truncate text-xs text-slate-400">{card.meta}</p>}
                      </button>
                      {card.badge !== null && <StatusBadge tone={card.badge.tone} label={card.badge.label} />}
                    </div>
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      </div>

      {bulkSchedule && (
        <BulkScheduleDialog
          applicantIds={selection.ids}
          onClose={() => setBulkSchedule(false)}
          onDone={selection.clear}
        />
      )}
    </div>
  );
};
