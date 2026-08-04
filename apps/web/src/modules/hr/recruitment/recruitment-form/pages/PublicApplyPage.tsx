// The page a candidate reaches from a source's link. No session, no shell, no navigation — the
// only thing it can do is submit an application, and the token in the URL is what says which
// source that application came from. The candidate never chooses, and never sees, the source list.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { type PublicRecruitmentFormDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { BrandMark } from '../../../../../shared/ui/BrandMark';
import { Button } from '../../../../../shared/ui/Button';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Form, FormActions } from '../../../../../shared/ui/form';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { getPublicApplyForm, submitPublicApplyForm } from '../api/recruitment-form-api';
import { FormFieldInput, checkAnswer, type Answers } from '../components/FormFieldInput';

type Phase =
  | { kind: 'loading' }
  | { kind: 'gone' }
  | { kind: 'form'; form: PublicRecruitmentFormDto }
  | { kind: 'done'; code: string };

export const PublicApplyPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const { token = '' } = useParams();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getPublicApplyForm(token)
      .then((form) => live && setPhase({ kind: 'form', form }))
      // A wrong, revoked or expired link is one outcome, not three: the page cannot tell a
      // candidate which, and it should not tell an attacker either.
      .catch(() => live && setPhase({ kind: 'gone' }));
    return () => {
      live = false;
    };
  }, [token]);

  if (phase.kind === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center">
        <LoadingState />
      </div>
    );
  }

  const shell = (children: JSX.Element): JSX.Element => (
    <div className="min-h-screen bg-slate-50 py-8 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-3xl px-4">
        <div className="mb-6 flex justify-center">
          <BrandMark />
        </div>
        {children}
      </div>
    </div>
  );

  if (phase.kind === 'gone') {
    return shell(
      <Card>
        <CardBody className="py-12 text-center text-slate-600 dark:text-slate-300">
          {t('apply.linkGone')}
        </CardBody>
      </Card>,
    );
  }

  if (phase.kind === 'done') {
    return shell(
      <Card>
        <CardBody className="space-y-3 py-12 text-center">
          <p className="text-lg font-medium text-slate-800 dark:text-slate-100">{t('apply.thanks')}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('apply.reference')}</p>
          <p className="text-xl font-semibold tracking-wide text-slate-900 dark:text-slate-50" dir="ltr">
            {phase.code}
          </p>
        </CardBody>
      </Card>,
    );
  }

  const { form } = phase;

  const check = (key: string): void => {
    const field = form.fields.find((f) => f.key === key);
    if (field === undefined) return;
    setErrors((prev) => {
      const problem = checkAnswer(field, answers);
      const next = { ...prev };
      if (problem === undefined) delete next[key];
      else next[key] = t(problem);
      return next;
    });
  };

  const submit = (): void => {
    const found: Record<string, string> = {};
    for (const field of form.fields) {
      const problem = checkAnswer(field, answers);
      if (problem !== undefined) found[field.key] = t(problem);
    }
    setErrors(found);
    const first = form.fields.find((f) => found[f.key] !== undefined);
    if (first !== undefined) {
      const el = document.getElementById(first.key);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus({ preventScroll: true });
      return;
    }
    setSending(true);
    setFailure(null);
    void submitPublicApplyForm(token, answers)
      .then((res) => setPhase({ kind: 'done', code: res.code }))
      .catch((error: Error & { details?: { field?: string; message: string }[] }) => {
        // The server checks the same rules again; anything it rejects is shown on its own field.
        const details = error.details ?? [];
        const perField: Record<string, string> = {};
        for (const d of details) if (d.field !== undefined) perField[d.field] = d.message;
        setErrors(perField);
        setFailure(Object.keys(perField).length > 0 ? null : error.message);
      })
      .finally(() => setSending(false));
  };

  return shell(
    <Card>
      <CardHeader
        title={form.title[locale]}
        description={form.intro === null ? form.sourceName[locale] : form.intro[locale]}
      />
      <CardBody>
        <Form onSubmit={submit}>
          {failure !== null && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {failure}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {form.fields.map((field) => (
              <FormFieldInput
                key={field.key}
                field={field}
                answers={answers}
                error={errors[field.key]}
                onChange={(patch) => setAnswers((prev) => ({ ...prev, ...patch }))}
                onBlur={() => check(field.key)}
                locale={locale}
              />
            ))}
          </div>
          <FormActions>
            <Button type="submit" loading={sending}>{t('apply.submit')}</Button>
          </FormActions>
        </Form>
      </CardBody>
    </Card>,
  );
};
