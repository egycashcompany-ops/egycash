// The A4 sheet, the face found on it, and the card-shaped frame around it — moved by dragging, sized
// with the slider (or the mouse wheel), previewed as the card will show it. «استخدام هذا القص» hands
// the crop back as an ordinary photo file; nothing is uploaded from here.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { cn } from '../../../../../shared/lib/cn';
import { clampRect, cropToFile, defaultCrop, locateFace, resizeCrop, type Rect } from './a4-face';

type Phase = 'reading' | 'searching' | 'found' | 'none' | 'failed';

export const A4FaceCropDialog = ({
  file,
  onClose,
  onCropped,
}: {
  /** The sheet to cut the face from; null keeps the dialog closed. */
  file: File | null;
  onClose: () => void;
  onCropped: (photo: File) => void;
}): JSX.Element | null => {
  const t = useT();
  const [sheet, setSheet] = useState<HTMLCanvasElement | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [phase, setPhase] = useState<Phase>('reading');
  const [busy, setBusy] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; from: Rect } | null>(null);

  // Read the sheet, then look for the face on it.
  useEffect(() => {
    if (file === null) return undefined;
    let alive = true;
    setSheet(null);
    setSheetUrl(null);
    setCrop(null);
    setPhase('reading');
    void (async () => {
      try {
        setPhase('searching');
        // The face wherever it is printed — a PDF's pictures are searched sharp, on their own; the
        // drawing shown is the one it was found on (the photo itself), or the whole page if none.
        const located = await locateFace(file);
        if (!alive) return;
        const drawn = located.sheet;
        setSheet(drawn);
        setSheetUrl(drawn.toDataURL('image/jpeg', 0.85));
        setCrop(located.crop ?? defaultCrop(drawn.width, drawn.height));
        setPhase(located.crop === null ? 'none' : 'found');
      } catch {
        if (alive) setPhase('failed');
      }
    })();
    return () => {
      alive = false;
    };
  }, [file]);

  // The preview: the crop as the card's frame will show it.
  useEffect(() => {
    const out = preview.current;
    if (out === null || sheet === null || crop === null) return;
    const ctx = out.getContext('2d');
    if (ctx === null) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(sheet, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
  }, [sheet, crop]);

  /** Screen pixels to sheet pixels: the sheet is shown shrunk to fit the stage. */
  const perPixel = (): number => {
    const shown = stage.current?.getBoundingClientRect().width ?? 1;
    return sheet === null ? 1 : sheet.width / shown;
  };

  // The slider says how tall the frame is, as a share of the tallest it may be.
  const maxH = useMemo(
    () =>
      sheet === null
        ? 1
        : Math.min(sheet.height, sheet.width / (crop === null ? 1 : crop.w / crop.h)),
    [sheet, crop],
  );
  const sizePercent = crop === null ? 30 : Math.round((crop.h / maxH) * 100);

  const resizeTo = (percent: number): void => {
    if (sheet === null || crop === null) return;
    setCrop(resizeCrop(crop, ((percent / 100) * maxH) / crop.h, sheet.width, sheet.height));
  };

  const use = async (): Promise<void> => {
    if (sheet === null || crop === null || file === null) return;
    setBusy(true);
    try {
      onCropped(await cropToFile(sheet, crop, file.name));
    } finally {
      setBusy(false);
    }
  };

  if (file === null) return null;

  const status: Record<Phase, { text: string; tone: string }> = {
    reading: { text: t('employees.photo.a4.reading'), tone: 'text-slate-500 dark:text-slate-400' },
    searching: {
      text: t('employees.photo.a4.searching'),
      tone: 'text-slate-500 dark:text-slate-400',
    },
    found: { text: t('employees.photo.a4.found'), tone: 'text-emerald-700 dark:text-emerald-300' },
    none: { text: t('employees.photo.a4.none'), tone: 'text-amber-700 dark:text-amber-300' },
    failed: { text: t('employees.photo.a4.failed'), tone: 'text-red-600 dark:text-red-400' },
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={t('employees.photo.a4.title')}
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={busy}
            disabled={crop === null || phase === 'reading' || phase === 'failed'}
            onClick={() => void use()}
          >
            {t('employees.photo.a4.use')}
          </Button>
        </>
      }
    >
      <p role="status" className={cn('mb-3 flex items-center gap-2 text-sm', status[phase].tone)}>
        {(phase === 'reading' || phase === 'searching') && (
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
        )}
        {status[phase].text}
      </p>

      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="flex w-full justify-center rounded-xl bg-slate-100 p-2 dark:bg-slate-800/70 sm:flex-1">
          {sheetUrl === null ? (
            <div className="grid h-80 w-full place-items-center text-sm text-slate-400">…</div>
          ) : (
            <div
              ref={stage}
              className="relative inline-block touch-none select-none overflow-hidden rounded shadow-card"
              onWheel={(e) => {
                if (crop === null) return;
                resizeTo(sizePercent + (e.deltaY < 0 ? 3 : -3));
              }}
            >
              <img
                src={sheetUrl}
                alt=""
                draggable={false}
                className="block max-h-[60vh] max-w-full"
              />
              {crop !== null && sheet !== null && (
                <div
                  role="slider"
                  aria-label={t('employees.photo.a4.frame')}
                  aria-valuenow={sizePercent}
                  tabIndex={0}
                  className="absolute cursor-move rounded-sm border-2 border-white shadow-[0_0_0_9999px_rgba(15,23,42,0.55)] outline-none ring-2 ring-brand-500 focus-visible:ring-4"
                  style={{
                    left: `${String((crop.x / sheet.width) * 100)}%`,
                    top: `${String((crop.y / sheet.height) * 100)}%`,
                    width: `${String((crop.w / sheet.width) * 100)}%`,
                    height: `${String((crop.h / sheet.height) * 100)}%`,
                  }}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    drag.current = { x: e.clientX, y: e.clientY, from: crop };
                  }}
                  onPointerMove={(e) => {
                    const from = drag.current;
                    if (from === null) return;
                    const k = perPixel();
                    setCrop(
                      clampRect(
                        {
                          ...from.from,
                          x: from.from.x + (e.clientX - from.x) * k,
                          y: from.from.y + (e.clientY - from.y) * k,
                        },
                        sheet.width,
                        sheet.height,
                      ),
                    );
                  }}
                  onPointerUp={() => {
                    drag.current = null;
                  }}
                  onKeyDown={(e) => {
                    const step = crop.w * 0.03;
                    const moves: Record<string, [number, number]> = {
                      ArrowLeft: [-step, 0],
                      ArrowRight: [step, 0],
                      ArrowUp: [0, -step],
                      ArrowDown: [0, step],
                    };
                    const move = moves[e.key];
                    if (move === undefined) return;
                    e.preventDefault();
                    setCrop(
                      clampRect(
                        { ...crop, x: crop.x + move[0], y: crop.y + move[1] },
                        sheet.width,
                        sheet.height,
                      ),
                    );
                  }}
                >
                  {/* The card's face guide: where a head sits in the frame. */}
                  <span className="pointer-events-none absolute inset-x-[22%] top-[10%] h-[52%] rounded-[50%] border border-dashed border-white/70" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex w-44 shrink-0 flex-col items-center gap-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('employees.photo.a4.preview')}
          </p>
          <canvas
            ref={preview}
            width={176}
            height={223}
            className="rounded-lg bg-white shadow-card ring-1 ring-slate-200 dark:ring-slate-700"
          />
          <label className="w-full text-xs text-slate-500 dark:text-slate-400">
            {t('employees.photo.a4.size')}
            <input
              type="range"
              min={5}
              max={100}
              value={sizePercent}
              disabled={crop === null}
              onChange={(e) => resizeTo(Number(e.target.value))}
              className="mt-1 w-full accent-brand-600"
            />
          </label>
          <p className="text-center text-[11px] leading-relaxed text-slate-400">
            {t('employees.photo.a4.help')}
          </p>
        </div>
      </div>
    </Dialog>
  );
};
