// Issuing a card, correcting one, and ending one (P-HR-MED D10, D13).
//
// THERE IS NO «RENEW» BUTTON, and its absence is the design: a renewal is what the provider does —
// one card ends and another is issued — and a single button for it would hide which number somebody
// actually held on a given day. The screen offers the two acts the provider offers.
//
// ENDING TAKES A DATE FROM THE USER, never «today». A card is usually ended after the fact — when
// somebody notices the policy lapsed, or that an employee left in March — and stamping the day of
// the paperwork would misdate every one of them.
import { useState } from 'react';
import { type Dependant, type InsuranceCardDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Textarea } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import {
  useEndInsuranceCard,
  useIssueInsuranceCard,
  useUpdateInsuranceCard,
} from '../api/medical-queries';
import { EmployeeSearch } from './EmployeeSearch';

/** One per line, «name — relationship». The honest editor for a list of two short strings. */
const toLines = (values: readonly Dependant[]): string =>
  values.map((d) => `${d.name} — ${d.relationship}`).join('\n');

const fromLines = (text: string): Dependant[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [name, relationship] = line.split(/\s+—\s+|\s+-\s+/);
      return { name: (name ?? line).trim(), relationship: (relationship ?? '—').trim() };
    })
    .filter((d) => d.name.length >= 2);

export const InsuranceCardDialog = ({
  card,
  onClose,
}: {
  /** Null when issuing a new one. */
  card: InsuranceCardDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const issue = useIssueInsuranceCard();
  const update = useUpdateInsuranceCard();
  const end = useEndInsuranceCard();

  const [employeeId, setEmployeeId] = useState('');
  const [provider, setProvider] = useState(card?.provider ?? '');
  const [cardNumber, setCardNumber] = useState(card?.cardNumber ?? '');
  const [tier, setTier] = useState(card?.tier ?? '');
  const [startsOn, setStartsOn] = useState(card?.startsOn.slice(0, 10) ?? '');
  const [endsOn, setEndsOn] = useState(card?.endsOn?.slice(0, 10) ?? '');
  const [dependants, setDependants] = useState(toLines(card?.dependants ?? []));
  const [note, setNote] = useState(card?.note ?? '');
  const [ending, setEnding] = useState(false);
  const [endedOn, setEndedOn] = useState('');
  const [endReason, setEndReason] = useState('');

  const isNew = card === null;
  const complete = isNew
    ? employeeId !== '' && provider.trim() !== '' && cardNumber.trim() !== '' && startsOn !== ''
    : provider.trim() !== '' && cardNumber.trim() !== '';

  const save = async (): Promise<void> => {
    if (!complete) return;
    try {
      if (isNew) {
        await issue.mutateAsync({
          employeeId,
          provider: provider.trim(),
          cardNumber: cardNumber.trim(),
          ...(tier.trim() === '' ? {} : { tier: tier.trim() }),
          startsOn: new Date(startsOn),
          ...(endsOn === '' ? {} : { endsOn: new Date(endsOn) }),
          dependants: fromLines(dependants),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        });
        toast.success(t('medical.insurance.issued'));
      } else {
        await update.mutateAsync({
          id: card.id,
          body: {
            provider: provider.trim(),
            cardNumber: cardNumber.trim(),
            tier: tier.trim() === '' ? null : tier.trim(),
            endsOn: endsOn === '' ? null : new Date(endsOn),
            dependants: fromLines(dependants),
            note: note.trim() === '' ? null : note.trim(),
            version: card.version,
          },
        });
        toast.success(t('medical.insurance.updated'));
      }
      onClose();
    } catch {
      // surfaced globally — including «already holds an active card»
    }
  };

  const submitEnd = async (): Promise<void> => {
    if (card === null || endedOn === '') return;
    try {
      await end.mutateAsync({
        id: card.id,
        body: {
          endedOn: new Date(endedOn),
          ...(endReason.trim() === '' ? {} : { reason: endReason.trim() }),
          version: card.version,
        },
      });
      toast.success(t('medical.insurance.ended'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(isNew ? 'medical.insurance.issue' : 'medical.insurance.manage')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {!ending && (
            <Button
              loading={issue.isPending || update.isPending}
              disabled={!complete}
              onClick={() => void save()}
            >
              {t(isNew ? 'medical.insurance.issue' : 'common.save')}
            </Button>
          )}
        </>
      }
    >
      {ending && card !== null ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('medical.insurance.endWarning')}
          </p>
          {/* The date the user gives, not the clock's — see the file's note. */}
          <Field label={t('medical.insurance.endedOn')} required>
            <Input
              type="date"
              value={endedOn}
              onChange={(e) => setEndedOn(e.target.value)}
              dir="ltr"
            />
          </Field>
          <Field label={t('medical.insurance.endReason')}>
            <Input
              value={endReason}
              onChange={(e) => setEndReason(e.target.value)}
              maxLength={500}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEnding(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              loading={end.isPending}
              disabled={endedOn === ''}
              onClick={() => void submitEnd()}
            >
              {t('medical.insurance.end')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {isNew && (
            <EmployeeSearch
              value={employeeId}
              onChange={setEmployeeId}
              label={t('medical.profile.employee')}
            />
          )}
          {!isNew && (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {`${card.employeeName} · ${card.employeeCode}`}
            </p>
          )}

          <div className="flex gap-3">
            <Field label={t('medical.insurance.provider')} required>
              <Input
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                maxLength={200}
              />
            </Field>
            <Field label={t('medical.insurance.cardNumber')} required>
              <Input
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                maxLength={60}
                dir="ltr"
              />
            </Field>
          </div>

          {/* As written, never derived from a grade — §8 Q2. The hint says so. */}
          <Field label={t('medical.insurance.tier')} hint={t('medical.insurance.tierHint')}>
            <Input value={tier} onChange={(e) => setTier(e.target.value)} maxLength={100} />
          </Field>

          <div className="flex gap-3">
            <Field label={t('medical.insurance.startsOn')} required={isNew}>
              <Input
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                disabled={!isNew}
                dir="ltr"
              />
            </Field>
            <Field label={t('medical.insurance.endsOn')} hint={t('medical.insurance.endsOnHint')}>
              <Input
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                dir="ltr"
              />
            </Field>
          </div>

          <Field
            label={t('medical.insurance.dependants')}
            hint={t('medical.insurance.dependantsHint')}
          >
            <Textarea value={dependants} onChange={(e) => setDependants(e.target.value)} rows={3} />
          </Field>

          <Field label={t('medical.insurance.note')}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </Field>

          {!isNew && card.status === 'active' && (
            <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
              <Button size="sm" variant="secondary" onClick={() => setEnding(true)}>
                {t('medical.insurance.end')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
};
