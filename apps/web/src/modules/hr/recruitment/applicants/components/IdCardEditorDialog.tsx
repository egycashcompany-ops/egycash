// HR's rotate / crop / replace of one National-ID card image.
//
// The edit is made in the browser on a canvas and uploaded as the card's NEXT VERSION. Nothing is
// overwritten: the original and every earlier edit stay in the card's history, from where any of
// them can be brought back.
//
// CROP IS A MODE. «قص» opens a frame with four corner handles over the picture: drag a handle to
// resize, drag inside to move, drag outside to draw a new frame. «تطبيق القص» shows the cropped
// result; «إلغاء» leaves the mode and keeps what was there before. Saving uploads the result.
//
// The image is fetched with the signed-in session (`fetchBlob`) rather than through a signed link,
// so the canvas holds same-origin pixels and can be exported.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type FileDto, type NationalIdCardSide } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { CropIcon, RotateCcwIcon, RotateCwIcon, UploadIcon } from '../../../../../shared/ui/icons';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { fetchBlob } from '../../../../../shared/lib/api-client';
import { editCard } from '../../applicant-documents/api/applicant-document-api';
import { refreshCardQueries, ReplaceCardInput } from './card-replace';

/** A crop frame in fractions (0–1) of the ROTATED image, so it survives the preview's scaling. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { kind: 'move'; from: { x: number; y: number }; start: Box }
  | { kind: 'corner'; corner: Corner; start: Box }
  | { kind: 'draw'; from: { x: number; y: number } };

const PREVIEW_MAX = 560;
/** The smallest frame, as a fraction of each side, so a stray click never crops to a sliver. */
const MIN_SIDE = 0.05;
const DEFAULT_BOX: Box = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));

/** Draw `img` turned by `quarter` quarter-turns clockwise onto a fresh canvas at `scale`. */
const rotated = (img: HTMLImageElement, quarter: number, scale: number): HTMLCanvasElement => {
  const turns = ((quarter % 4) + 4) % 4;
  const iw = img.naturalWidth * scale;
  const ih = img.naturalHeight * scale;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(turns % 2 === 0 ? iw : ih);
  canvas.height = Math.round(turns % 2 === 0 ? ih : iw);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return canvas;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
  return canvas;
};

/** The part of `source` inside `box`, as its own canvas. */
const cropped = (source: HTMLCanvasElement, box: Box): HTMLCanvasElement => {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(box.w * source.width));
  out.height = Math.max(1, Math.round(box.h * source.height));
  out
    .getContext('2d')
    ?.drawImage(source, box.x * source.width, box.y * source.height, out.width, out.height, 0, 0, out.width, out.height);
  return out;
};

export const IdCardEditorDialog = ({
  open,
  onClose,
  applicantId,
  file,
  side,
  title,
}: {
  open: boolean;
  onClose: () => void;
  applicantId: string;
  file: FileDto | null;
  side: NationalIdCardSide | null;
  title: string;
}): JSX.Element => {
  const t = useT();
  const qc = useQueryClient();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [quarter, setQuarter] = useState(0);
  /** The applied crop — what will be saved. */
  const [box, setBox] = useState<Box | null>(null);
  /** The frame being adjusted while crop mode is open; null = not cropping. */
  const [draft, setDraft] = useState<Box | null>(null);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const cropping = draft !== null;

  // Load the current version's bytes whenever the dialog opens on a file.
  useEffect(() => {
    if (!open || file === null) return;
    let live = true;
    let made: string | null = null;
    setImg(null);
    setFailed(false);
    setQuarter(0);
    setBox(null);
    setDraft(null);
    void fetchBlob(`/platform/files/${file.id}/download`)
      .then((blob) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => live && setImg(image);
        image.onerror = () => live && setFailed(true);
        image.src = made;
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [open, file]);

  // Draw the preview: the whole rotated picture while cropping (or with no crop), else the result.
  useEffect(() => {
    const target = canvasRef.current;
    if (img === null || target === null) return;
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    const whole = rotated(img, quarter, Math.min(1, PREVIEW_MAX / longest));
    const drawn = cropping || box === null ? whole : cropped(whole, box);
    target.width = drawn.width;
    target.height = drawn.height;
    target.getContext('2d')?.drawImage(drawn, 0, 0);
  }, [img, quarter, box, cropping]);

  const turn = (by: number): void => {
    setQuarter((q) => q + by);
    // A frame drawn on the old orientation no longer frames the same part of the card.
    setBox(null);
    setDraft(null);
  };

  const startCrop = (): void => setDraft(box ?? DEFAULT_BOX);
  const applyCrop = (): void => {
    if (draft === null) return;
    // A frame covering (almost) everything is no crop at all.
    setBox(draft.w > 0.99 && draft.h > 0.99 ? null : draft);
    setDraft(null);
  };
  const cancelCrop = (): void => setDraft(null);

  const pointAt = (e: ReactPointerEvent<HTMLElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / rect.width), y: clamp((e.clientY - rect.top) / rect.height) };
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (draft === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const handle = (e.target as HTMLElement).dataset.corner as Corner | undefined;
    const p = pointAt(e);
    if (handle !== undefined) drag.current = { kind: 'corner', corner: handle, start: draft };
    else if (p.x >= draft.x && p.x <= draft.x + draft.w && p.y >= draft.y && p.y <= draft.y + draft.h) {
      drag.current = { kind: 'move', from: p, start: draft };
    } else drag.current = { kind: 'draw', from: p };
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null) return;
    const p = pointAt(e);
    if (d.kind === 'move') {
      const s = d.start;
      setDraft({
        ...s,
        x: clamp(s.x + p.x - d.from.x, 0, 1 - s.w),
        y: clamp(s.y + p.y - d.from.y, 0, 1 - s.h),
      });
      return;
    }
    if (d.kind === 'draw') {
      const w = Math.abs(p.x - d.from.x);
      const h = Math.abs(p.y - d.from.y);
      if (w < MIN_SIDE || h < MIN_SIDE) return;
      setDraft({ x: Math.min(p.x, d.from.x), y: Math.min(p.y, d.from.y), w, h });
      return;
    }
    // A corner: the opposite corner stays put.
    const s = d.start;
    const left = d.corner === 'nw' || d.corner === 'sw' ? clamp(p.x, 0, s.x + s.w - MIN_SIDE) : s.x;
    const right = d.corner === 'ne' || d.corner === 'se' ? clamp(p.x, s.x + MIN_SIDE, 1) : s.x + s.w;
    const top = d.corner === 'nw' || d.corner === 'ne' ? clamp(p.y, 0, s.y + s.h - MIN_SIDE) : s.y;
    const bottom = d.corner === 'sw' || d.corner === 'se' ? clamp(p.y, s.y + MIN_SIDE, 1) : s.y + s.h;
    setDraft({ x: left, y: top, w: right - left, h: bottom - top });
  };

  const onUp = (): void => {
    drag.current = null;
  };

  const turns = ((quarter % 4) + 4) % 4;
  const changed = (turns !== 0 || box !== null) && !cropping;

  const save = async (): Promise<void> => {
    if (img === null || side === null || !changed) return;
    setSaving(true);
    try {
      // Full resolution: the edit is made on the real pixels, not on the preview.
      const full = rotated(img, quarter, 1);
      const out = box === null ? full : cropped(full, box);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/jpeg', 0.92));
      if (blob === null) throw new Error('export failed');
      const note = [
        turns === 0
          ? null
          : turns === 3
            ? t('applicants.idCard.edit.noteRotateLeft')
            : t('applicants.idCard.edit.noteRotate', { deg: String(turns * 90) }),
        box === null ? null : t('applicants.idCard.edit.noteCrop'),
      ]
        .filter((p): p is string => p !== null)
        .join(' · ');
      await editCard(applicantId, side, blob, note);
      await refreshCardQueries(qc, applicantId);
      toast.success(t('applicants.idCard.edit.saved'));
      onClose();
    } catch {
      toast.error(t('applicants.idCard.edit.failed'));
    } finally {
      setSaving(false);
    }
  };

  const handle = (corner: Corner, cls: string): JSX.Element => (
    <span
      data-corner={corner}
      className={`absolute h-4 w-4 rounded-sm border-2 border-white bg-brand-600 shadow ${cls}`}
      style={{ touchAction: 'none' }}
    />
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={title}
      description={t('applicants.idCard.edit.hint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={saving} disabled={!changed || img === null} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {cropping ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                <CropIcon className="h-4 w-4" />
                {t('applicants.idCard.edit.cropping')}
              </span>
              <Button size="sm" onClick={applyCrop}>
                {t('applicants.idCard.edit.applyCrop')}
              </Button>
              <Button size="sm" variant="secondary" onClick={cancelCrop}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => turn(-1)} disabled={img === null}>
                <RotateCcwIcon className="h-4 w-4" />
                {t('applicants.idCard.edit.rotateLeft')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => turn(1)} disabled={img === null}>
                <RotateCwIcon className="h-4 w-4" />
                {t('applicants.idCard.edit.rotateRight')}
              </Button>
              <Button size="sm" variant="secondary" onClick={startCrop} disabled={img === null}>
                <CropIcon className="h-4 w-4" />
                {t('applicants.idCard.edit.crop')}
              </Button>
              {box !== null && (
                <Button size="sm" variant="ghost" onClick={() => setBox(null)}>
                  {t('applicants.idCard.edit.clearCrop')}
                </Button>
              )}
              {side !== null && (
                <ReplaceCardInput
                  applicantId={applicantId}
                  side={side}
                  onDone={onClose}
                  trigger={(pick) => (
                    <Button size="sm" variant="ghost-brand" onClick={pick}>
                      <UploadIcon className="h-4 w-4" />
                      {t('applicants.idCard.replace.open')}
                    </Button>
                  )}
                />
              )}
            </>
          )}
        </div>
        <div className="grid min-h-48 place-items-center rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
          {failed ? (
            <p className="text-sm text-slate-500">{t('applicants.idCard.previewFailed')}</p>
          ) : img === null ? (
            <Spinner />
          ) : (
            <div className="relative inline-block max-w-full overflow-hidden rounded-md">
              <canvas ref={canvasRef} className="block max-w-full select-none rounded-md" />
              {cropping && draft !== null && (
                <div
                  className="absolute inset-0 cursor-crosshair touch-none select-none"
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                >
                  <div
                    className="absolute cursor-move border-2 border-dashed border-white shadow-[0_0_0_9999px_rgba(15,23,42,0.55)]"
                    style={{
                      left: `${draft.x * 100}%`,
                      top: `${draft.y * 100}%`,
                      width: `${draft.w * 100}%`,
                      height: `${draft.h * 100}%`,
                    }}
                  >
                    {/* Thirds, as a camera shows them — easier to square a card up. */}
                    <span className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/40" />
                    <span className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/40" />
                    <span className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/40" />
                    <span className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/40" />
                    {handle('nw', '-left-2 -top-2 cursor-nwse-resize')}
                    {handle('ne', '-right-2 -top-2 cursor-nesw-resize')}
                    {handle('sw', '-bottom-2 -left-2 cursor-nesw-resize')}
                    {handle('se', '-bottom-2 -right-2 cursor-nwse-resize')}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {!cropping && box !== null && (
          <p className="text-xs text-slate-500">{t('applicants.idCard.edit.croppedShown')}</p>
        )}
      </div>
    </Dialog>
  );
};
