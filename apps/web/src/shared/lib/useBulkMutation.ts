// One hook for every bulk action (RW17/I4). The backend runs each item in its own transaction and
// answers with a partial-success envelope, so the UI's job is to report it HONESTLY: how many
// applied, how many did not, and why — never a blanket "done" over a mixed result.
//
// I6 — a bulk response also carries the entries the batch wrote and the refreshed counters, so the
// caller's `applyResult` writes those into the cache instead of invalidating them. What it cannot
// carry is the changed rows themselves (a selection spans many, and which of them still belong on a
// filtered queue is the server's judgement), so the affected list is re-read once.
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { type BulkActionResultDto, type BulkWorkflowResultDto } from '@ecms/contracts';
import { useT } from '../../platform/localization/useT';
import { toast } from '../ui/toast/toast-store';

export interface BulkMutationOptions {
  /** Apply the bulk response to the cache — one helper per module. */
  applyResult: (qc: QueryClient, result: BulkWorkflowResultDto) => void;
  /** Called after a run in which at least one item applied (e.g. to clear the selection). */
  onApplied?: () => void;
}

/** The message a partial-success envelope deserves: exact, and never silently optimistic. */
export const bulkOutcomeMessage = (
  result: BulkActionResultDto,
  t: (key: string) => string,
): { message: string; ok: boolean } => {
  if (result.failed === 0) {
    return { message: t('bulk.result.allOk').replace('{n}', String(result.succeeded)), ok: true };
  }
  if (result.succeeded === 0) {
    return { message: t('bulk.result.allFailed').replace('{n}', String(result.failed)), ok: false };
  }
  return {
    message: t('bulk.result.partial')
      .replace('{ok}', String(result.succeeded))
      .replace('{failed}', String(result.failed)),
    ok: false,
  };
};

export const useBulkMutation = <TInput>(
  run: (input: TInput) => Promise<BulkWorkflowResultDto>,
  options: BulkMutationOptions,
) => {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: run,
    onSuccess: (result) => {
      options.applyResult(qc, result);
      const { message, ok } = bulkOutcomeMessage(result, t);
      if (ok) toast.success(message);
      else toast.error(message);
      if (result.succeeded > 0) options.onApplied?.();
    },
  });
};
