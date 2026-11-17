// The card as it will print, front and back, on a card you can turn over.
//
// Both faces are drawn by `card-render.ts` into canvases the caller keeps — the same canvases go to
// the printer, so what is previewed is exactly what is printed. The flip is CSS (a real 3D turn,
// with a light that sweeps the laminate as it moves); a reader who asked for less motion gets a
// plain swap.
import { useEffect, useMemo, useRef, useState } from 'react';
import { type EmployeeIdCardDataDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { cn } from '../../../../../shared/lib/cn';
import {
  CARD_H,
  CARD_W,
  DEFAULT_SIGNER,
  drawBack,
  drawFront,
  loadCardArt,
  loadImage,
  type IdCardFace,
} from './card-render';

export interface IdCardCanvases {
  front: HTMLCanvasElement;
  back: HTMLCanvasElement;
}

/** What the card says, from the card data the server answered with. */
export const faceOf = (data: EmployeeIdCardDataDto | undefined, locale: Locale): IdCardFace => ({
  name: data?.fullNameAr ?? '',
  // The card is Arabic whatever the screen's language; English only when there is no Arabic name.
  job:
    data?.jobTitle === null || data?.jobTitle === undefined
      ? ''
      : data.jobTitle.ar || data.jobTitle[locale],
  number: data?.employeeNumber ?? '',
  code: data?.code ?? '',
  nationalId: data?.nationalId ?? '',
  signerName: DEFAULT_SIGNER.name,
  signerTitle: DEFAULT_SIGNER.title,
});

/**
 * Draws both faces whenever the data or the photo changes, and hands back the canvases (for the
 * printer) and their pictures (for the screen). `ready` is false until the artwork has loaded.
 */
export const useIdCardCanvases = (
  face: IdCardFace,
  photoUrl: string | null,
): {
  canvases: IdCardCanvases;
  frontUrl: string | null;
  backUrl: string | null;
  ready: boolean;
} => {
  const canvases = useMemo<IdCardCanvases>(
    () => ({ front: document.createElement('canvas'), back: document.createElement('canvas') }),
    [],
  );
  const [urls, setUrls] = useState<{ front: string | null; back: string | null }>({
    front: null,
    back: null,
  });
  const [ready, setReady] = useState(false);
  const key = JSON.stringify(face);

  useEffect(() => {
    let alive = true;
    // Not ready again until this photo is on the canvas: printing in between would print without it.
    setReady(false);
    void (async () => {
      const [art, photo] = await Promise.all([
        loadCardArt().catch(() => null),
        photoUrl === null ? Promise.resolve(null) : loadImage(photoUrl).catch(() => null),
      ]);
      // The card's own fonts first: drawn before they arrive, the words would print in a fallback.
      await document.fonts.ready.catch(() => undefined);
      if (!alive) return;
      drawFront(canvases.front, art, face, photo);
      drawBack(canvases.back);
      setUrls({
        front: canvases.front.toDataURL('image/png'),
        back: canvases.back.toDataURL('image/png'),
      });
      setReady(art !== null);
    })();
    return () => {
      alive = false;
    };
  }, [key, photoUrl, canvases]);

  return { canvases, frontUrl: urls.front, backUrl: urls.back, ready };
};

export const IdCardPreview = ({
  frontUrl,
  backUrl,
  className,
}: {
  frontUrl: string | null;
  backUrl: string | null;
  className?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [back, setBack] = useState(false);
  const card = useRef<HTMLButtonElement>(null);

  // A gentle tilt toward the pointer, so the laminate catches the light — and nothing more.
  const tilt = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const el = card.current;
    if (el === null || event.pointerType !== 'mouse') return;
    const box = el.getBoundingClientRect();
    const dx = (event.clientX - box.left) / box.width - 0.5;
    const dy = (event.clientY - box.top) / box.height - 0.5;
    el.style.setProperty('--tilt-x', `${String(-dy * 8)}deg`);
    el.style.setProperty('--tilt-y', `${String(dx * 10)}deg`);
    el.style.setProperty('--shine', `${String((dx + 0.5) * 100)}%`);
  };
  const rest = (): void => {
    card.current?.style.setProperty('--tilt-x', '0deg');
    card.current?.style.setProperty('--tilt-y', '0deg');
  };

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <div
        className="w-full max-w-[440px] [perspective:1400px]"
        style={{ aspectRatio: `${String(CARD_W)} / ${String(CARD_H)}` }}
      >
        <button
          ref={card}
          type="button"
          onClick={() => setBack((b) => !b)}
          onPointerMove={tilt}
          onPointerLeave={rest}
          aria-label={t('employees.idCard.flip')}
          title={t('employees.idCard.flip')}
          className="group relative h-full w-full cursor-pointer rounded-[14px] outline-none transition-transform duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] [transform-style:preserve-3d] focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:transition-none"
          style={{
            transform: `rotateX(var(--tilt-x, 0deg)) rotateY(calc(var(--tilt-y, 0deg) + ${back ? (locale === 'ar' ? -180 : 180) : 0}deg))`,
          }}
        >
          {[
            { url: frontUrl, side: 'front' as const },
            { url: backUrl, side: 'back' as const },
          ].map(({ url, side }) => (
            <span
              key={side}
              className={cn(
                'absolute inset-0 overflow-hidden rounded-[14px] bg-white shadow-[0_18px_40px_-18px_rgba(30,30,80,0.55),0_2px_6px_rgba(0,0,0,0.12)] ring-1 ring-black/5 [backface-visibility:hidden]',
                side === 'back' && '[transform:rotateY(180deg)]',
              )}
            >
              {url === null ? (
                <span className="block h-full w-full animate-pulse bg-slate-100 dark:bg-slate-800" />
              ) : (
                <img
                  src={url}
                  alt=""
                  className="h-full w-full select-none object-cover"
                  draggable={false}
                />
              )}
              {/* The laminate: a soft band of light that follows the pointer. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                  background:
                    'linear-gradient(105deg, transparent calc(var(--shine, 50%) - 22%), rgba(255,255,255,0.38) var(--shine, 50%), transparent calc(var(--shine, 50%) + 22%))',
                }}
              />
            </span>
          ))}
        </button>
      </div>
      <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1 text-xs dark:bg-slate-800">
        {(['front', 'back'] as const).map((side) => (
          <button
            key={side}
            type="button"
            onClick={() => setBack(side === 'back')}
            aria-pressed={back === (side === 'back')}
            className={cn(
              'rounded-full px-3 py-1 transition-colors',
              back === (side === 'back')
                ? 'bg-white font-semibold text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400',
            )}
          >
            {t(`employees.idCard.${side}`)}
          </button>
        ))}
      </div>
    </div>
  );
};
