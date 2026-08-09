// Posting to the ticket's stream (design §2.6, FR-7, FR-14).
//
// The visibility toggle is offered ONLY to a caller holding `itTicket.edit`, because only they may
// post an internal note — but the toggle is a convenience, not the boundary: the server refuses an
// `internal` body from anyone else, and the stream query never returns internal rows to a reader
// without the grant. Nothing here is load-bearing for confidentiality.
//
// `public` is the default and stays the default after every post: an internal note must be a
// conscious choice each time, never a sticky mode a technician forgets they are in.
import { useState } from 'react';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Button } from '../../../shared/ui/Button';
import { Field, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useCreateItTicketComment } from '../api/it-queries';

export const TicketCommentForm = ({
  ticketId,
  disabled = false,
  disabledReason,
}: {
  ticketId: string;
  disabled?: boolean;
  disabledReason?: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const post = useCreateItTicketComment();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mayPostInternal = can('itTicket.edit');

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await post.mutateAsync({
        id: ticketId,
        body: { body: body.trim(), visibility: internal ? 'internal' : 'public' },
      });
      setBody('');
      setInternal(false);
      toast.success(t('it.tickets.commentPosted'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  if (disabled) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {disabledReason ?? t('it.tickets.commentClosed')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error !== null && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <Field label={t('it.tickets.addComment')}>
        <Textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('it.tickets.commentPlaceholder')}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {mayPostInternal ? (
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900"
            />
            {t('it.tickets.internalOnly')}
          </label>
        ) : (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('it.tickets.commentPublicHint')}
          </span>
        )}
        <Button
          size="sm"
          loading={post.isPending}
          disabled={body.trim() === ''}
          onClick={() => void submit()}
        >
          {t('it.tickets.postComment')}
        </Button>
      </div>
      {internal && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {t('it.tickets.internalWarning')}
        </p>
      )}
    </div>
  );
};
