// «+ خط جديد» and «تعديل الاسم والقائد» (S-8 b, DS-17, §9.7): a crew line's name — unique on its
// day (`DUPLICATE_NAME`) — and its optional free-text leader (GS-15).
import { useEffect, useState } from 'react';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input } from '../../../../shared/ui/form';

export const RouteDialog = ({
  open,
  title,
  initial,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  initial: { name: string; leaderName: string | null };
  busy: boolean;
  error: string | null;
  onConfirm: (value: { name: string; leaderName: string | null }) => void;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const [name, setName] = useState(initial.name);
  const [leader, setLeader] = useState(initial.leaderName ?? '');
  useEffect(() => {
    if (!open) return;
    setName(initial.name);
    setLeader(initial.leaderName ?? '');
  }, [open]);
  const trimmed = name.trim();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={busy}
            disabled={trimmed === ''}
            onClick={() =>
              onConfirm({ name: trimmed, leaderName: leader.trim() === '' ? null : leader.trim() })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label={t('atm.control.route.name')}
          htmlFor="route-name"
          required
          error={error ?? undefined}
        >
          <Input
            id="route-name"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t('atm.control.route.leader')} htmlFor="route-leader">
          <Input
            id="route-leader"
            maxLength={80}
            value={leader}
            onChange={(e) => setLeader(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
};
