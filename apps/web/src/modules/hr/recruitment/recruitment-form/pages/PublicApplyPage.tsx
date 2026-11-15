// The page a candidate reaches from a source's link. No session, no shell, no navigation — the
// only thing it can do is submit an application. The link's token says which form this is and
// where the candidate arrived from; the candidate also tells us how they heard about us, and that
// answer is what the applicant is recorded under.
//
// Four sections: the details, how they heard of us, the National ID card (read and checked against
// the typed number), and the papers — the military certificate (men only, required) and an
// optional licence and qualification, which land in the applicant's document folder for HR.
import { useEffect, useMemo, useState } from 'react';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/500.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import { useParams } from 'react-router-dom';
import {
  PUBLIC_HEARD_FROM_FIELD,
  PUBLIC_ID_CARD_FIELD,
  PUBLIC_MILITARY_FIELD,
  asciiDigits,
  parseNationalId,
  type PublicApplyDocument,
  type PublicRecruitmentFormDto,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useDocumentTitle } from '../../../../../shared/lib/useDocumentTitle';
import { useAppSelector } from '../../../../../store';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Input, Select } from '../../../../../shared/ui/form';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import {
  getPublicApplyForm,
  submitPublicApplyForm,
  uploadPublicCardPhoto,
  uploadPublicCv,
} from '../api/recruitment-form-api';
import { CvUploadRow } from '../components/CvUploadRow';
import { FormFieldInput, checkAnswer, type Answers } from '../components/FormFieldInput';
import { CardPhotoBox, type CardPhoto } from '../components/CardPhotoBox';
import {
  ApplyAside,
  ApplyError,
  ApplyFinish,
  ApplyHeader,
  ApplyNotice,
  ApplySection,
  ApplyShell,
  ApplySteps,
  ApplySurface,
  jumpTo,
  type ApplyStep,
} from '../components/ApplyLayout';

type Phase =
  | { kind: 'loading' }
  | { kind: 'gone' }
  | { kind: 'form'; form: PublicRecruitmentFormDto }
  | { kind: 'done'; code: string };

/** The «other» choice in the source list — not a source, so not an id. */
const OTHER = '__other';

type ApiError = Error & { details?: { field?: string; code?: string; message: string }[] };

export const PublicApplyPage = (): JSX.Element => {
  const t = useT();
  useDocumentTitle('EGYCASH');
  const locale = useAppSelector((state) => state.locale.locale);
  const { token = '' } = useParams();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // The two card photos. Both are required: the card is read and checked against the National ID
  // number typed in the form before the application is accepted.
  const [front, setFront] = useState<CardPhoto | null>(null);
  const [back, setBack] = useState<CardPhoto | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  // «How did you hear about us»: a source id, OTHER, or '' while unanswered.
  const [heard, setHeard] = useState('');
  const [heardOther, setHeardOther] = useState('');
  const [papers, setPapers] = useState<Partial<Record<PublicApplyDocument, string>>>({});
  const [paperErrors, setPaperErrors] = useState<Partial<Record<PublicApplyDocument, string>>>({});
  const [cvFileId, setCvFileId] = useState<string | null>(null);
  const [cvError, setCvError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void getPublicApplyForm(token)
      .then((form) => {
        if (!live) return;
        // Each link belongs to one source (the Facebook link, the WhatsApp link…), so «how did you
        // hear about us» starts on it; the candidate can still change it.
        if ((form.sources ?? []).some((s) => s.id === form.linkSourceId)) setHeard(form.linkSourceId);
        setPhase({ kind: 'form', form });
      })
      // A wrong, revoked or expired link is one outcome, not three: the page cannot tell a
      // candidate which, and it should not tell an attacker either.
      .catch(() => live && setPhase({ kind: 'gone' }));
    return () => {
      live = false;
    };
  }, [token]);

  // Men must hand in a military certificate; women have none. Read off the typed National ID —
  // until it parses, the box shows and says who it is for.
  const typedId = typeof answers.nationalId === 'string' ? answers.nationalId : '';
  const gender = useMemo(() => parseNationalId(asciiDigits(typedId).replace(/\D/g, ''))?.gender ?? null, [typedId]);
  const militaryRequired = gender === 'male';
  const militaryShown = gender !== 'female';

  if (phase.kind === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 dark:bg-slate-950">
        <LoadingState />
      </div>
    );
  }

  if (phase.kind === 'gone') {
    return (
      <ApplyShell header={<ApplyHeader title={t('apply.linkGoneTitle')} intro={t('apply.rail.intro')} />}>
        <ApplyNotice tone="neutral" title={t('apply.linkGoneTitle')}>
          <p>{t('apply.linkGone')}</p>
        </ApplyNotice>
      </ApplyShell>
    );
  }

  if (phase.kind === 'done') {
    return (
      <ApplyShell header={<ApplyHeader title={t('apply.thanks')} intro={t('apply.doneNext')} />}>
        <ApplyNotice tone="success" title={t('apply.thanks')}>
          <p>{t('apply.reference')}</p>
          <p
            dir="ltr"
            className="mx-auto inline-block rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 font-figures text-xl font-semibold tracking-wider text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
          >
            {phase.code}
          </p>
          <p className="text-xs">{t('apply.doneNext')}</p>
        </ApplyNotice>
      </ApplyShell>
    );
  }

  const { form } = phase;

  // ── What is done ─────────────────────────────────────────────────────────
  const detailsDone = form.fields.every((f) => checkAnswer(f, answers) === undefined);
  const heardDone = heard !== '' && (heard !== OTHER || heardOther.trim() !== '');
  const cardDone = front !== null && back !== null;
  const papersDone = !militaryShown || papers.militaryService !== undefined;
  const steps: ApplyStep[] = [
    { id: 'apply-details', label: t('apply.step.details'), done: detailsDone },
    { id: 'apply-heard', label: t('apply.step.source'), done: heardDone },
    { id: 'apply-id-card', label: t('apply.step.card'), done: cardDone },
    { id: 'apply-papers', label: t('apply.step.papers'), done: papersDone },
  ];

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

  const setPaper = (key: PublicApplyDocument, photo: CardPhoto | null): void => {
    setPapers((prev) => {
      const next = { ...prev };
      if (photo === null) delete next[key];
      else next[key] = photo.fileId;
      return next;
    });
    setPaperErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  /** The server judges everything again; each refusal is shown where it can be fixed. */
  const showServerErrors = (error: ApiError): void => {
    const perField: Record<string, string> = {};
    const perPaper: Partial<Record<PublicApplyDocument, string>> = {};
    let card: string | null = null;
    let where: string | null = null;
    for (const d of error.details ?? []) {
      if (d.field === PUBLIC_ID_CARD_FIELD) {
        // The card is refused by CODE, said in the page's language.
        card = d.code === undefined ? d.message : t(`apply.idCard.error.${d.code}`);
        where ??= 'apply-id-card';
      } else if (d.field === PUBLIC_HEARD_FROM_FIELD) {
        perField[d.field] = t('apply.heardFrom.required');
        where ??= 'apply-heard';
      } else if (d.field === 'cv') {
        setCvError(t('apply.papers.uploadAgain'));
        where ??= 'apply-papers';
      } else if (d.field === PUBLIC_MILITARY_FIELD || d.field === 'drivingLicense' || d.field === 'qualification') {
        perPaper[d.field] =
          d.field === PUBLIC_MILITARY_FIELD && papers.militaryService === undefined
            ? t('apply.papers.militaryRequired')
            : t('apply.papers.uploadAgain');
        where ??= 'apply-papers';
      } else if (d.field !== undefined) {
        perField[d.field] = d.message;
        where ??= 'apply-details';
      }
    }
    setErrors(perField);
    setPaperErrors(perPaper);
    setCardError(card);
    if (where !== null) jumpTo(where);
    setFailure(where === null ? error.message : null);
  };

  const submit = (): void => {
    const found: Record<string, string> = {};
    for (const field of form.fields) {
      const problem = checkAnswer(field, answers);
      if (problem !== undefined) found[field.key] = t(problem);
    }
    if (!heardDone) found[PUBLIC_HEARD_FROM_FIELD] = t('apply.heardFrom.required');
    setErrors(found);
    const first = form.fields.find((f) => found[f.key] !== undefined);
    if (first !== undefined) {
      jumpTo('apply-details');
      document.getElementById(first.key)?.focus({ preventScroll: true });
      return;
    }
    if (!heardDone) {
      jumpTo('apply-heard');
      document.getElementById('heard-from')?.focus({ preventScroll: true });
      return;
    }
    if (front === null || back === null) {
      setCardError(t('apply.idCard.error.ID_CARD_REQUIRED'));
      jumpTo('apply-id-card');
      return;
    }
    if (militaryRequired && papers.militaryService === undefined) {
      setPaperErrors({ militaryService: t('apply.papers.militaryRequired') });
      jumpTo('apply-papers');
      return;
    }
    setSending(true);
    setFailure(null);
    setCardError(null);
    void submitPublicApplyForm(
      token,
      answers,
      { frontFileId: front.fileId, backFileId: back.fileId },
      {
        heardFrom: heard === OTHER ? { sourceId: null, other: heardOther.trim() } : { sourceId: heard },
        documents: militaryShown ? papers : { ...papers, militaryService: undefined },
        ...(cvFileId === null ? {} : { cvFileId }),
      },
    )
      .then((res) => {
        setPhase({ kind: 'done', code: res.code });
        window.scrollTo({ top: 0 });
      })
      .catch((error: ApiError) => showServerErrors(error))
      .finally(() => setSending(false));
  };

  const clearHeardError = (): void =>
    setErrors((prev) => {
      const next = { ...prev };
      delete next[PUBLIC_HEARD_FROM_FIELD];
      return next;
    });

  const sendButton = (
    <Button type="submit" loading={sending} className="w-full sm:w-auto">
      {t('apply.submit')}
    </Button>
  );

  return (
    <ApplyShell
      header={
        <ApplyHeader
          title={form.title[locale]}
          intro={form.intro === null ? t('apply.rail.intro') : form.intro[locale]}
        >
          <ApplySteps steps={steps} />
        </ApplyHeader>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <form
          noValidate
          aria-busy={sending}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          {failure !== null && <ApplyError>{failure}</ApplyError>}

          <ApplySurface>
            <ApplySection id="apply-details" n={1} title={t('apply.step.details')} intro={t('apply.details.intro')} done={detailsDone} prevDone={null}>
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
            </ApplySection>

            <ApplySection id="apply-heard" n={2} title={t('apply.heardFrom.title')} intro={t('apply.heardFrom.intro')} done={heardDone} prevDone={detailsDone}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label={t('apply.heardFrom.label')}
                  htmlFor="heard-from"
                  required
                  error={heard !== OTHER ? errors[PUBLIC_HEARD_FROM_FIELD] : undefined}
                >
                  <Select
                    id="heard-from"
                    value={heard}
                    error={errors[PUBLIC_HEARD_FROM_FIELD] !== undefined && heard === ''}
                    onChange={(e) => {
                      setHeard(e.target.value);
                      clearHeardError();
                    }}
                  >
                    <option value="" disabled>
                      {t('apply.heardFrom.pick')}
                    </option>
                    {(form.sources ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name[locale]}
                      </option>
                    ))}
                    <option value={OTHER}>{t('apply.heardFrom.other')}</option>
                  </Select>
                </Field>
                {heard === OTHER && (
                  <Field
                    label={t('apply.heardFrom.otherLabel')}
                    htmlFor="heard-other"
                    required
                    error={heardOther.trim() === '' ? errors[PUBLIC_HEARD_FROM_FIELD] : undefined}
                  >
                    <Input
                      id="heard-other"
                      autoFocus
                      maxLength={200}
                      value={heardOther}
                      placeholder={t('apply.heardFrom.otherPlaceholder')}
                      onChange={(e) => {
                        setHeardOther(e.target.value);
                        clearHeardError();
                      }}
                    />
                  </Field>
                )}
              </div>
            </ApplySection>

            <ApplySection id="apply-id-card" n={3} title={t('apply.idCard.title')} intro={t('apply.idCard.intro')} done={cardDone} prevDone={heardDone}>
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <CardPhotoBox
                    label={t('apply.idCard.front')}
                    art="idFront"
                    upload={(file) => uploadPublicCardPhoto(token, file)}
                    onChange={(p) => {
                      setFront(p);
                      setCardError(null);
                    }}
                    invalid={cardError !== null}
                  />
                  <CardPhotoBox
                    label={t('apply.idCard.back')}
                    art="idBack"
                    upload={(file) => uploadPublicCardPhoto(token, file)}
                    onChange={(p) => {
                      setBack(p);
                      setCardError(null);
                    }}
                    invalid={cardError !== null}
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('apply.idCard.hint')}</p>
                {cardError !== null && <ApplyError>{cardError}</ApplyError>}
              </div>
            </ApplySection>

            <ApplySection id="apply-papers" n={4} title={t('apply.papers.title')} intro={t('apply.papers.intro')} done={papersDone} prevDone={cardDone}>
              <div className="space-y-3">
                <CvUploadRow
                  upload={(file) => uploadPublicCv(token, file)}
                  onChange={(id) => {
                    setCvFileId(id);
                    setCvError(undefined);
                  }}
                  errorText={cvError}
                />
                {militaryShown && (
                  <CardPhotoBox
                    label={t('apply.papers.military')}
                    hint={gender === null ? t('apply.papers.militaryMen') : undefined}
                    layout="row"
                    required
                    upload={(file) => uploadPublicCardPhoto(token, file)}
                    onChange={(p) => setPaper('militaryService', p)}
                    invalid={paperErrors.militaryService !== undefined}
                  errorText={paperErrors.militaryService}
                  />
                )}
                <CardPhotoBox
                  label={t('apply.papers.license')}
                  layout="row"
                  required={false}
                  upload={(file) => uploadPublicCardPhoto(token, file)}
                  onChange={(p) => setPaper('drivingLicense', p)}
                  invalid={paperErrors.drivingLicense !== undefined}
                  errorText={paperErrors.drivingLicense}
                />
                <CardPhotoBox
                  label={t('apply.papers.qualification')}
                  layout="row"
                  required={false}
                  upload={(file) => uploadPublicCardPhoto(token, file)}
                  onChange={(p) => setPaper('qualification', p)}
                  invalid={paperErrors.qualification !== undefined}
                  errorText={paperErrors.qualification}
                />
              </div>
            </ApplySection>

            {/* The end of the line: send */}
            <div className="hidden lg:block">
              <ApplyFinish
                ready={steps.every((s) => s.done)}
                hint={sending ? t('apply.idCard.checking') : t('apply.sendHint')}
              >
                {sendButton}
              </ApplyFinish>
            </div>
          </ApplySurface>

          {/* Send — pinned to the bottom on a phone */}
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 lg:hidden">
            <p className="mb-2 text-center text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
              {sending ? t('apply.idCard.checking') : t('apply.progress', { n: steps.filter((s) => s.done).length })}
            </p>
            {sendButton}
          </div>
        </form>
        <ApplyAside />
      </div>
    </ApplyShell>
  );
};
