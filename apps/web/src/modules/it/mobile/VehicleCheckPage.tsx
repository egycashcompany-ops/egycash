// «فحص أجهزة السيارة» — IT's phone form (FR-21, docs/12-planning/it-vehicle-checks-design.md §2):
// the car, the day, «يعمل / لا يعمل» for the screen, the eight cameras, the DVR and the Motorola
// radio, one note, and one to five photos. Every device opens at «يعمل» and the reporter taps what
// fails; one may still be left unanswered. Required (2026-11-09): the car, a day (which the box
// starts with), a note while a device is «لا يعمل», and at least one photo (`vehicleCheckRequired`).
//
// A phone screen OUTSIDE the console frame: the shared `PhoneShell` (the captain's frame, moved),
// its back arrow to the home page — the one page a user whose only grant is this form is sure to
// have — and a bar fixed at the foot with the count and the one action under the thumb. The look
// is the owner-approved sample's, drawn in Cairo as Fleet's screens are (`BOARD_FONT`).
//
// The send: the report first (its `clientRequestId` makes a repeated send the same report), then
// each photo against it, one at a time; a photo that did not go up is an outcome on the sent view,
// never a reason to file the report again. Each refused send moves the form as the outcome table
// says (`vehicleCheckSendFailure`). While the form is filled, it is kept as a draft in the tab's
// session storage (`vehicle-check-draft.ts`), so a phone that unloads the tab while its camera app
// is open gives it back.
//
// A photo is drawn small as it is picked, which takes a moment: the send waits for the picks still
// being drawn (`createPhotoQueue`), and once the report is sent a pick still running is dropped,
// never carried to the next car's form. A lone photo still being drawn is not counted yet, so the
// required fields name «الصور» until it arrives (a photo is required, 2026-11-09).
import { useEffect, useId, useRef, useState } from 'react';
import {
  IT_VEHICLE_CHECK_ITEMS,
  IT_VEHICLE_CHECK_NOTES_MAX,
  type CreateItVehicleCheck,
  type ItVehicleCheckAnswer,
  type ItVehicleCheckDto,
  type ItVehicleCheckItem,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { downscaleToJpeg } from '../../../shared/lib/image-downscale';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { PhoneShell } from '../../../shared/ui/PhoneShell';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { DateBox } from '../../fleet/components/DateBox';
import { BOARD_FONT } from '../../fleet/components/FuelCardBoard';
import { fileVehicleCheck, uploadVehicleCheckPhoto } from '../api/it-api';
import { useItVehicleCheckCars } from '../api/it-queries';
import {
  answerTapped,
  applySendFailure,
  checkCounts,
  defaultCheckDate,
  emptyVehicleCheck,
  newClientId,
  notesNeeded,
  requestIdAfterEdit,
  vehicleCheckPayload,
  vehicleCheckRequired,
  vehicleCheckSendFailure,
  type VehicleCheckFormState,
  type VehicleCheckSendToast,
} from '../lib/vehicle-check-form';
import {
  VEHICLE_CHECK_MAX_PHOTOS,
  VEHICLE_CHECK_PHOTO_DOWNSCALE,
  createPhotoQueue,
  photoFileName,
  photoRoom,
  photoToSend,
  tallyPhotos,
  uploadPhotosInOrder,
} from '../lib/vehicle-check-photos';
import { VehicleCheckAnswer } from './VehicleCheckAnswer';
import { VehicleCheckCarPicker } from './VehicleCheckCarPicker';
import { VehicleCheckPhotos, type VehicleCheckPickedPhoto } from './VehicleCheckPhotos';
import {
  VehicleCheckSent,
  sentLeaveStep,
  sentWithoutPhoto,
  type VehicleCheckSentSummary,
} from './VehicleCheckSent';
import {
  clearVehicleCheckDraft,
  draftWorthKeeping,
  readVehicleCheckDraft,
  reconcileDraftCar,
  writeVehicleCheckDraft,
} from './vehicle-check-draft';
import { CARD, CARD_TITLE } from './vehicle-check-looks';

const CAMERAS = IT_VEHICLE_CHECK_ITEMS.filter((item) => item.startsWith('camera'));

/** The sent view, and what «إعادة رفع الصور» still has to send. */
interface Sent {
  reportId: string;
  summary: VehicleCheckSentSummary;
  failed: VehicleCheckPickedPhoto[];
}

/**
 * The form a reload gives back — the tab's draft, or an empty form on today. A restored request id
 * counts as HELD: it may have gone out on a send whose answer never came before the tab was
 * unloaded, so an edit from here on gives the report a new one (renewing an id that never went out
 * costs nothing).
 */
const restore = (): {
  form: VehicleCheckFormState;
  code: string;
  held: CreateItVehicleCheck | null;
} => {
  const draft = readVehicleCheckDraft({ today: defaultCheckDate(), newId: newClientId });
  if (draft === null) return { form: emptyVehicleCheck(), code: '', held: null };
  const { vehicleId, checkDate, items, notes, clientRequestId, vehicleCode } = draft;
  const form = { vehicleId, checkDate, items, notes, clientRequestId };
  return { form, code: vehicleCode, held: vehicleCheckPayload(form) };
};

export const VehicleCheckPage = (): JSX.Element => {
  const t = useT();
  const carId = useId();
  const dateId = useId();
  const notesId = useId();
  const today = defaultCheckDate();
  const [restored] = useState(restore);
  const [form, setForm] = useState<VehicleCheckFormState>(restored.form);
  /** The chosen car's code, for the draft and for the box until the car list arrives. */
  const [vehicleCode, setVehicleCode] = useState(restored.code);
  const [photos, setPhotos] = useState<VehicleCheckPickedPhoto[]>([]);
  // The photos as they are NOW, for the work that outlives a render: a photo is drawn small after
  // an await, and the send reads the list after the report is filed.
  const photosRef = useRef<VehicleCheckPickedPhoto[]>([]);
  // The picks still being drawn small, one after another: what a send waits for (§6.3).
  const [photoQueue] = useState(createPhotoQueue);
  // The body that went out under a HELD request id — a send whose outcome is unknown — or null.
  const heldRef = useRef<CreateItVehicleCheck | null>(restored.held);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  // A tap already tried to leave a sent report that has no photo: the next one goes (`sentLeaveStep`).
  const [askedToLeave, setAskedToLeave] = useState(false);
  const [round, setRound] = useState(0);
  const cars = useItVehicleCheckCars();

  const required = useRequiredFields(
    // Each name held on one line in the banner (no-break spaces): on a 375px phone the banner
    // wraps, and «كود» at a line's end with «السيارة.» under it reads as two things.
    vehicleCheckRequired(form, photos.length, {
      vehicle: t('it.vehicleCheck.vehicle').replace(/ /gu, '\u00a0'),
      date: t('it.vehicleCheck.date').replace(/ /gu, '\u00a0'),
      notes: t('it.vehicleCheck.notes'),
      photos: t('it.vehicleCheck.photos'),
    }),
    round,
  );
  // A device «لا يعمل» makes the note required (`vehicleCheckRequired`).
  const needsNotes = notesNeeded(form);
  const notesMissing = required.isMissing('notes');

  // Every device's name, each a literal key the IT dictionary check can see.
  const labels: Record<ItVehicleCheckItem, string> = {
    screen: t('it.vehicleCheck.item.screen'),
    camera1: t('it.vehicleCheck.item.camera1'),
    camera2: t('it.vehicleCheck.item.camera2'),
    camera3: t('it.vehicleCheck.item.camera3'),
    camera4: t('it.vehicleCheck.item.camera4'),
    camera5: t('it.vehicleCheck.item.camera5'),
    camera6: t('it.vehicleCheck.item.camera6'),
    camera7: t('it.vehicleCheck.item.camera7'),
    camera8: t('it.vehicleCheck.item.camera8'),
    dvr: t('it.vehicleCheck.item.dvr'),
    radio: t('it.vehicleCheck.item.radio'),
  };
  const sendToasts: Record<VehicleCheckSendToast, string> = {
    failed: t('it.vehicleCheck.toast.failed'),
    carGone: t('it.vehicleCheck.toast.carGone'),
    carInactive: t('it.vehicleCheck.toast.carInactive'),
    futureDay: t('it.vehicleCheck.toast.futureDay'),
    notesRequired: t('it.vehicleCheck.toast.notesRequired'),
  };

  // A restored car the active list no longer carries is cleared, with a new request id.
  const carIds = cars.data?.items;
  useEffect(() => {
    if (carIds === undefined || form.vehicleId === '') return;
    const active = new Set(carIds.map((car) => car.id));
    if (active.has(form.vehicleId)) return;
    setForm((now) => reconcileDraftCar(now, active, newClientId));
    setVehicleCode('');
  }, [carIds, form.vehicleId]);

  // A report with no photo whose failed photos wait for «إعادة رفع الصور»: a reload or a closed tab
  // would lose them, and no screen can add a photo afterwards — so the browser asks first.
  const photosAtStake = sent !== null && sentWithoutPhoto(sent.summary) && sent.failed.length > 0;
  useEffect(() => {
    if (!photosAtStake) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Older browsers show the prompt only when `returnValue` is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [photosAtStake]);

  // The draft follows the form while it is filled; the sent view keeps none.
  useEffect(() => {
    if (sent !== null) return;
    if (draftWorthKeeping(form, defaultCheckDate())) writeVehicleCheckDraft(form, vehicleCode);
    else clearVehicleCheckDraft();
  }, [form, vehicleCode, sent]);

  // The previews are object URLs: let them go with the page, and keep nothing a pick still running
  // would add after it.
  useEffect(
    () => () => {
      photoQueue.reset();
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
    },
    [photoQueue],
  );

  const setPhotoList = (next: VehicleCheckPickedPhoto[]): void => {
    photosRef.current = next;
    setPhotos(next);
  };

  /**
   * Each photo drawn small (a JPEG, its location data left behind), or refused with a toast. The
   * picks queue one after another, so the room is counted on a list no other pick is adding to.
   */
  const addPhotos = (files: readonly File[]): void => {
    photoQueue.add(async (live) => {
      for (const file of files) {
        if (photoRoom(photosRef.current.length) === 0) {
          toast.error(t('it.vehicleCheck.toast.photoLimit', { max: VEHICLE_CHECK_MAX_PHOTOS }));
          return;
        }
        const downscaled = await downscaleToJpeg(file, VEHICLE_CHECK_PHOTO_DOWNSCALE);
        // The form this pick was made for is gone (the report was sent, or «تقرير لسيارة أخرى»):
        // the photo belongs to no form on screen, and is not carried to the next car's.
        if (!live()) return;
        const choice = photoToSend(file, downscaled);
        if ('refused' in choice) {
          toast.error(
            choice.refused === 'type'
              ? t('it.vehicleCheck.toast.photoBadType')
              : t('it.vehicleCheck.toast.photoTooBig'),
          );
          continue;
        }
        const blob = choice.blob === 'downscaled' && downscaled !== null ? downscaled : file;
        setPhotoList([
          ...photosRef.current,
          {
            clientPhotoId: newClientId(),
            file: blob,
            fileName: photoFileName(blob.type, photosRef.current.length),
            url: URL.createObjectURL(blob),
          },
        ]);
      }
    });
  };

  const removePhoto = (clientPhotoId: string): void => {
    for (const photo of photosRef.current) {
      if (photo.clientPhotoId === clientPhotoId) URL.revokeObjectURL(photo.url);
    }
    setPhotoList(photosRef.current.filter((photo) => photo.clientPhotoId !== clientPhotoId));
  };

  const dropAllPhotos = (): void => {
    for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
    setPhotoList([]);
  };

  /**
   * Every edit of the car, the day, an answer or the note. While a request id is held from a send
   * whose outcome is unknown, an edit makes this another report, with a new id (§6.3).
   */
  const edit = (change: (now: VehicleCheckFormState) => VehicleCheckFormState): void =>
    setForm((now) => requestIdAfterEdit(change(now), heldRef.current, newClientId));

  const tap = (item: ItVehicleCheckItem, answer: ItVehicleCheckAnswer): void =>
    edit((now) => ({ ...now, items: answerTapped(now.items, item, answer) }));

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      // A photo still being drawn small was picked for THIS report: wait for it, so it goes up
      // with the others instead of being left out and dropped.
      await photoQueue.settled();
      const payload = vehicleCheckPayload(form);
      let report: ItVehicleCheckDto;
      try {
        report = await fileVehicleCheck(payload);
      } catch (error) {
        const failure = vehicleCheckSendFailure(error);
        // The id is held exactly when the outcome is unknown; an edit from here on renews it.
        heldRef.current = failure.newRequestId ? null : payload;
        toast.error(sendToasts[failure.toast]);
        setForm((now) =>
          applySendFailure(now, failure, { today: defaultCheckDate(), newId: newClientId }),
        );
        if (failure.clearCar) setVehicleCode('');
        if (failure.refetchCars) void cars.refetch();
        return;
      }
      // Filed (201, or 200 for a report this id already filed). The picks were for this report:
      // one still running now (a file dialog left open) is not carried to the next form.
      heldRef.current = null;
      photoQueue.reset();
      const picked = photosRef.current;
      // Now the photos, one at a time.
      let photoCount = report.photos.length;
      const outcomes = await uploadPhotosInOrder(report.id, picked, async (id, photo) => {
        photoCount = (await uploadVehicleCheckPhoto(id, photo)).photos.length;
      });
      const tally = tallyPhotos(outcomes);
      clearVehicleCheckDraft();
      dropAllPhotos();
      setSent({
        reportId: report.id,
        failed: tally.failed,
        summary: {
          vehicleCode: report.vehicleCode,
          checkDate: report.checkDate,
          counts: checkCounts(report.items),
          photoCount,
          failed: tally.failed.length,
          refused: tally.refused.map((refusal) => refusal.code),
        },
      });
      // Cleared but for the day, with a new request id — the next report is another report.
      setForm((now) => emptyVehicleCheck(now.checkDate));
      setVehicleCode('');
      window.scrollTo({ top: 0 });
    } finally {
      setBusy(false);
    }
  };

  /** «إعادة رفع الصور»: the photos that had no answer, to the SAME report, with their own ids. */
  const retryPhotos = async (): Promise<void> => {
    if (sent === null || retrying) return;
    setRetrying(true);
    try {
      let photoCount = sent.summary.photoCount;
      const outcomes = await uploadPhotosInOrder(sent.reportId, sent.failed, async (id, photo) => {
        photoCount = (await uploadVehicleCheckPhoto(id, photo)).photos.length;
      });
      const tally = tallyPhotos(outcomes);
      setSent((now) =>
        now === null
          ? now
          : {
              ...now,
              failed: tally.failed,
              summary: {
                ...now.summary,
                photoCount,
                failed: tally.failed.length,
                refused: [...now.summary.refused, ...tally.refused.map((refusal) => refusal.code)],
              },
            },
      );
    } finally {
      setRetrying(false);
    }
  };

  /** «تقرير لسيارة أخرى»: the form cleared, the day kept — and no photo from the last car. */
  const another = (): void => {
    photoQueue.reset();
    dropAllPhotos();
    heldRef.current = null;
    clearVehicleCheckDraft();
    setSent(null);
    setAskedToLeave(false);
    setForm((now) => emptyVehicleCheck(now.checkDate));
    setVehicleCode('');
    setRound((n) => n + 1);
    window.scrollTo({ top: 0 });
  };

  const frame = (content: JSX.Element, footer?: JSX.Element): JSX.Element => (
    // Cairo, the face the owner's samples are drawn in and Fleet's screens use; the page inherits
    // it from here, the header included, so the shared frame stays the captain's as it was.
    <div className={BOARD_FONT} data-vehicle-check-page="true">
      <PhoneShell
        title={t('it.vehicleCheck.title')}
        subtitle={t('it.module.title')}
        backTo="/"
        backLabel={t('it.vehicleCheck.back')}
        // On the sent view, a report with no photo is not left on the first tap: it asks, as
        // «تقرير لسيارة أخرى» does (`sentLeaveStep`).
        onBack={(event) => {
          if (sent === null || sentLeaveStep(sent.summary, askedToLeave) === 'leave') return;
          event.preventDefault();
          setAskedToLeave(true);
          window.scrollTo({ top: document.documentElement.scrollHeight });
        }}
        {...(footer === undefined ? {} : { footer })}
      >
        {content}
      </PhoneShell>
    </div>
  );

  if (sent !== null) {
    return frame(
      <VehicleCheckSent
        summary={sent.summary}
        retrying={retrying}
        onRetry={() => void retryPhotos()}
        onAnother={another}
        askedToLeave={askedToLeave}
        onAskToLeave={() => setAskedToLeave(true)}
      />,
    );
  }

  const counts = checkCounts(form.items);

  /** A card that IS one device — «الشاشة», «DVR», «جهاز الاتصال (موتورولا)». */
  const oneItem = (item: ItVehicleCheckItem): JSX.Element => (
    <section
      className={cn(CARD, 'flex items-center gap-2 px-4 py-3')}
      data-vehicle-check-item={item}
    >
      <h2 className={cn(CARD_TITLE, 'min-w-0 flex-1')}>{labels[item]}</h2>
      <VehicleCheckAnswer
        label={labels[item]}
        value={form.items[item]}
        onTap={(answer) => tap(item, answer)}
        disabled={busy}
      />
    </section>
  );

  /** The foot: how far the check has got, and the one action — under the thumb. */
  const bar = (
    <div data-vehicle-check-bar="true" className="mx-auto max-w-2xl space-y-2 px-4 pb-3 pt-2.5">
      <p
        aria-live="polite"
        data-vehicle-check-count="true"
        className="truncate text-center text-sm font-medium text-slate-600 dark:text-slate-300"
      >
        {t('it.vehicleCheck.progress', { done: counts.done, total: counts.total })}
        {counts.notWorking > 0 && (
          <>
            {' · '}
            <span className="font-bold text-red-600 dark:text-red-400">
              {t('it.vehicleCheck.progressFaults', { count: counts.notWorking })}
            </span>
          </>
        )}
      </p>
      <Button
        onClick={required.guard(submit)}
        loading={busy}
        className="min-h-12 w-full !text-base"
        data-vehicle-check-send="true"
      >
        {t('it.vehicleCheck.send')}
      </Button>
    </div>
  );

  return frame(
    <div className="space-y-4">
      <MissingFieldsBanner
        missing={required.missing}
        attempt={required.attempt}
        lead={t('it.vehicleCheck.notSent')}
        className="scroll-mt-20"
      />
      <section className={cn(CARD, 'space-y-4 p-4')} data-vehicle-check-head="true">
        <Field
          label={t('it.vehicleCheck.vehicle')}
          htmlFor={carId}
          required
          missing={required.isMissing('vehicle')}
        >
          <VehicleCheckCarPicker
            id={carId}
            value={form.vehicleId}
            pendingCode={vehicleCode}
            onChange={(vehicleId, code) => {
              edit((now) => ({ ...now, vehicleId }));
              setVehicleCode(code);
            }}
            disabled={busy}
          />
        </Field>
        <Field
          label={t('it.vehicleCheck.date')}
          htmlFor={dateId}
          missing={required.isMissing('date')}
        >
          <DateBox label={t('it.vehicleCheck.date')} disabled={busy}>
            <Input
              id={dateId}
              type="date"
              value={form.checkDate}
              // A later day is refused here, and by the server.
              max={today}
              onChange={(e) => {
                const checkDate = e.target.value;
                edit((now) => ({ ...now, checkDate }));
              }}
              disabled={busy}
              textScale="comfortable"
              className="!py-3"
              data-vehicle-check-date="true"
            />
          </DateBox>
        </Field>
      </section>

      {oneItem('screen')}

      <section className={CARD} data-vehicle-check-cameras="true">
        <h2 className={cn(CARD_TITLE, 'border-b border-slate-100 px-4 py-3 dark:border-slate-800')}>
          {t('it.vehicleCheck.cameras')}
        </h2>
        <ol className="divide-y divide-slate-100 dark:divide-slate-800">
          {CAMERAS.map((item, index) => (
            // One row: the number and name at the start, the two answers at the end.
            <li
              key={item}
              className="flex items-center gap-2 px-4 py-2.5"
              data-vehicle-check-item={item}
            >
              <p className="flex min-w-0 flex-1 items-center gap-2.5 text-[15px] font-semibold text-slate-800 dark:text-slate-100">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">{labels[item]}</span>
              </p>
              <VehicleCheckAnswer
                label={t('it.vehicleCheck.cameraRow', { n: index + 1, label: labels[item] })}
                value={form.items[item]}
                onTap={(answer) => tap(item, answer)}
                disabled={busy}
              />
            </li>
          ))}
        </ol>
      </section>

      {oneItem('dvr')}
      {oneItem('radio')}

      <section className={cn(CARD, 'space-y-3 p-4')} data-vehicle-check-notes-card="true">
        <label
          htmlFor={notesId}
          className={cn(
            'block',
            notesMissing ? 'text-base font-bold text-red-600 dark:text-red-400' : CARD_TITLE,
          )}
        >
          {t('it.vehicleCheck.notes')}
          {needsNotes && <span className="text-red-500"> *</span>}
        </label>
        {/* The card's own title is the label; the Field only marks the box and says why. */}
        <Field
          missing={notesMissing}
          hint={needsNotes ? t('it.vehicleCheck.notesNeeded') : undefined}
        >
          <Textarea
            id={notesId}
            rows={3}
            textScale="comfortable"
            value={form.notes}
            maxLength={IT_VEHICLE_CHECK_NOTES_MAX}
            onChange={(e) => {
              const notes = e.target.value;
              edit((now) => ({ ...now, notes }));
            }}
            disabled={busy}
            placeholder={
              needsNotes
                ? t('it.vehicleCheck.notesPlaceholderFault')
                : t('it.vehicleCheck.notesPlaceholder')
            }
            aria-required={needsNotes}
            data-vehicle-check-notes="true"
          />
        </Field>
      </section>

      <VehicleCheckPhotos
        photos={photos}
        onAdd={addPhotos}
        onRemove={removePhoto}
        disabled={busy}
        missing={required.isMissing('photos')}
      />
    </div>,
    bar,
  );
};
