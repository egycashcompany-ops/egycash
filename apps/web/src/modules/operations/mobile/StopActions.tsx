// The captain's four acts: start, confirm collection, confirm delivery, finish.
//
// THE SERVER OWNS THE SEQUENCE. Every button here is derived from `nextAction`, which offers a
// move only on the stop the SERVER named `current` and only the single move its state machine
// allows from the current execution status. There is no optimistic update and nothing unlocks
// locally: after an act, the day is refetched and the next stop becomes available because the
// server says it has — which is the only way the screen and the lock can agree.
//
// ONE BUTTON AT A TIME, on purpose. A row of four with three disabled invites a captain to hunt
// for the enabled one; a single full-width action says what to do next and nothing else.
import { useState } from 'react';
import { type OperationsMobileStopDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Button } from '../../../shared/ui/Button';
import { CheckIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useCompleteStop,
  useConfirmStopDelivery,
  useConfirmStopPickup,
  useStartStop,
} from '../api/operations-queries';
import { nextAction, type CaptainAction } from './day-view';

export const StopActions = ({
  stop,
  onRefetch,
}: {
  stop: OperationsMobileStopDto;
  /** Re-read the day. Passed in so the caller decides what "the truth" is being re-read from. */
  onRefetch: () => Promise<unknown>;
}): JSX.Element | null => {
  const t = useT();
  const [pending, setPending] = useState(false);

  const start = useStartStop();
  const pickup = useConfirmStopPickup();
  const deliver = useConfirmStopDelivery();
  const complete = useCompleteStop();

  const action = nextAction(stop);

  // Settled and current — the day is done here. Say so rather than showing nothing, which reads
  // as a screen that failed to load its button.
  if (action === null) {
    if (stop.progress === 'completed' || stop.executionStatus === 'completed') {
      return (
        <p className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <CheckIcon className="h-4 w-4" aria-hidden="true" />
          {t('operations.mobile.action.done')}
        </p>
      );
    }
    return null;
  }

  const runners: Record<CaptainAction, (id: string) => Promise<unknown>> = {
    start: (id) => start.mutateAsync(id),
    pickup: (id) => pickup.mutateAsync(id),
    deliver: (id) => deliver.mutateAsync(id),
    complete: (id) => complete.mutateAsync(id),
  };

  const run = async (): Promise<void> => {
    setPending(true);
    try {
      await runners[action](stop.assignmentId);
      toast.success(t(`operations.mobile.action.${action}.done`));
    } catch {
      // Already reported, in the captain's words, by the mutation's own `onError` — which is also
      // what keeps the app-wide generic toast from firing beside it. Swallowed here so one refused
      // act produces exactly one message.
    } finally {
      // The screen re-reads either way: after a conflict the server's state is the one fact worth
      // having, and after a success it is what unlocks the next stop.
      await onRefetch();
      setPending(false);
    }
  };

  return (
    <Button
      onClick={() => void run()}
      disabled={pending}
      // Full width and 48px tall: pressed one-handed, standing up, wearing gloves.
      className="min-h-12 w-full text-base"
    >
      {t(pending ? 'operations.mobile.action.working' : `operations.mobile.action.${action}`)}
    </Button>
  );
};
