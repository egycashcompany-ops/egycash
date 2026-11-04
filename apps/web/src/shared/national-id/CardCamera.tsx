// The live card camera, as on the company's Readers page: the phone's main rear lens, a card-shaped
// frame over the picture, plain advice until the card is framed well ("move closer", "hold still",
// "glare"), and an automatic photo once it is. The front is followed straight away by the back on
// the same camera, which is the order a card is handled in and spares the phone a restart.
//
// The guide itself is the Readers page's own `capture_guide.js`, served unchanged from
// `/capture-guide.js` and loaded the first time the camera opens. It runs entirely in the browser
// on a small copy of each frame: nothing leaves the device until the person reads the card.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../platform/localization/useT';
import { useAppSelector } from '../../store';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { CheckIcon } from '../ui/icons';

export type CardSide = 'front' | 'back';

interface Guide {
  start: () => void;
  stop: () => void;
  capture: () => string;
  /** The sharpest of several frames taken about half a second apart (hand shake blurs some). */
  captureSharpest?: () => Promise<string>;
  readonly state: { card?: unknown } | null;
}

interface CaptureGuideApi {
  attach: (
    video: HTMLVideoElement,
    options: {
      side: () => CardSide;
      onCapture: (dataUrl: string) => void;
      auto?: boolean;
      showCard?: boolean;
    },
  ) => Guide;
  mainRearCamera: (devices: MediaDeviceInfo[]) => MediaDeviceInfo | null;
  MESSAGES: Record<string, string>;
}

declare global {
  interface Window {
    CaptureGuide?: CaptureGuideApi;
  }
}

/** A camera, for the button that goes on to the back of the card. */
const CameraIcon = ({ className }: { className?: string }): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <path d="M4 8h3l1.6-2.4A1.5 1.5 0 0 1 9.85 5h4.3a1.5 1.5 0 0 1 1.25.6L17 8h3a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 8Z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

/**
 * An iPhone or iPad. Its browsers give a page only the camera's video (one fixed lens, none of the
 * phone's photo processing), and the card came out small and soft where the iPhone's own camera
 * app took a sharp photo of it. There the camera button opens the camera app instead.
 */
const appleMobile = (): boolean =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** The live camera needs https (or localhost), a browser that offers it, and not an iPhone. */
export const liveCameraSupported = (): boolean =>
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  typeof navigator.mediaDevices?.getUserMedia === 'function' &&
  !appleMobile();

let loading: Promise<CaptureGuideApi | null> | null = null;
/** Loads the guide once; the camera still works without it (no frame, no automatic photo). */
const loadGuide = (): Promise<CaptureGuideApi | null> => {
  if (window.CaptureGuide !== undefined) return Promise.resolve(window.CaptureGuide);
  loading ??= new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = '/capture-guide.js';
    script.async = true;
    script.onload = () => resolve(window.CaptureGuide ?? null);
    script.onerror = () => {
      loading = null;
      resolve(null);
    };
    document.head.append(script);
  });
  return loading;
};

const MESSAGE_KEYS = [
  'noCard',
  'tooFar',
  'tooClose',
  'offCentre',
  'tilt',
  'keystone',
  'dark',
  'glare',
  'moving',
  'blurry',
  'same',
  'focusing',
  'good',
] as const;

/** A JPEG data URL as a File the rest of the flow treats like an upload. */
const toFile = (dataUrl: string, side: CardSide): File => {
  const [, body = ''] = dataUrl.split(',', 2);
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new File([bytes], `card-${side}-${Date.now()}.jpg`, { type: 'image/jpeg' });
};

// The main rear lens, once found, is remembered for the next card.
let rearCamera: string | null = null;
// As many pixels as the lens will stream: the photo is a frame of this video, and a name's letters
// misread at 1920 (the old cap) on a card held at arm's length. `ideal` never fails a camera that
// streams less; the guide works on a small copy of each frame, so its speed does not change.
const SIZE = { width: { ideal: 3840 }, height: { ideal: 2160 } } as const;

/** Focus settings some cameras take (Chrome on Android) and the browser types do not list yet. */
interface FocusCapabilities {
  focusMode?: string[];
  pointsOfInterest?: unknown;
}

/**
 * Keep the lens focusing, on the given point of the picture (0-1; the frame's centre by default),
 * where the camera lets a page ask: Chrome on Android does, an iPhone focuses by itself and lets a
 * page do nothing. Never fails the camera: a refused setting leaves it as it was.
 */
const focusOn = async (stream: MediaStream, x = 0.5, y = 0.5): Promise<void> => {
  const track = stream.getVideoTracks()[0];
  if (track === undefined || typeof track.getCapabilities !== 'function') return;
  const caps = track.getCapabilities() as FocusCapabilities;
  const modes = caps.focusMode ?? [];
  const wanted: Record<string, unknown> = {};
  if (modes.includes('continuous')) wanted.focusMode = 'continuous';
  if (caps.pointsOfInterest !== undefined) wanted.pointsOfInterest = [{ x, y }];
  if (Object.keys(wanted).length === 0) return;
  try {
    await track.applyConstraints({ advanced: [wanted as MediaTrackConstraintSet] });
  } catch {
    // the camera kept its own focus
  }
};

const openStream = (deviceId: string | null): Promise<MediaStream> =>
  navigator.mediaDevices.getUserMedia({
    audio: false,
    video:
      deviceId === null
        ? { facingMode: 'environment', ...SIZE }
        : { deviceId: { exact: deviceId }, ...SIZE },
  });

/**
 * The pause between the sides: the front just taken, turning over to the back on a card that
 * flips in place, and one clear button to go on. Covers the picture so nothing is taken meanwhile.
 */
const FlipPrompt = ({
  frontShot,
  onBack,
  onRetakeFront,
}: {
  frontShot: string | null;
  onBack: () => void;
  onRetakeFront: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t('nationalIdOcr.camera.flip.title')}
      className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-950/85 p-5 text-center text-white backdrop-blur-sm"
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-400/40">
        <CheckIcon className="h-3.5 w-3.5" />
        {t('nationalIdOcr.camera.flip.frontDone')}
      </span>

      <div className="[perspective:900px]" aria-hidden="true">
        <div className="card-flip relative aspect-[85.6/53.98] w-44 [transform-style:preserve-3d] sm:w-52">
          <div className="absolute inset-0 overflow-hidden rounded-xl bg-slate-200 shadow-2xl ring-1 ring-white/20 [backface-visibility:hidden]">
            {frontShot !== null && (
              <img src={frontShot} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="absolute inset-0 flex flex-col justify-center gap-1.5 overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 to-slate-300 px-4 shadow-2xl ring-1 ring-white/20 [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <span className="h-1.5 w-3/4 rounded-full bg-slate-400/70" />
            <span className="h-1.5 w-2/3 rounded-full bg-slate-400/60" />
            <span className="h-1.5 w-4/5 rounded-full bg-slate-400/60" />
            <span className="mt-2 h-4 w-full rounded bg-[repeating-linear-gradient(90deg,#475569_0_2px,transparent_2px_5px)] opacity-60" />
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-lg font-bold">{t('nationalIdOcr.camera.flip.title')}</p>
        <p className="mx-auto max-w-xs text-sm text-white/75">
          {t('nationalIdOcr.camera.flip.body')}
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-2">
        <Button onClick={onBack} className="min-h-[48px] w-full text-base" autoFocus>
          <CameraIcon className="h-5 w-5" />
          {t('nationalIdOcr.camera.flip.scanBack')}
        </Button>
        <button
          type="button"
          onClick={onRetakeFront}
          className="min-h-[40px] rounded-lg text-sm font-medium text-white/70 underline-offset-4 hover:text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          {t('nationalIdOcr.camera.flip.retakeFront')}
        </button>
      </div>
    </div>
  );
};

export const CardCamera = ({
  side,
  continueToBack,
  onPhoto,
  onClose,
}: {
  /** The side to photograph; `null` keeps the camera closed. */
  side: CardSide | null;
  /** After the front, go straight on to the back (it has no photo yet). */
  continueToBack: boolean;
  onPhoto: (side: CardSide, file: File) => void;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const guideRef = useRef<Guide | null>(null);
  const sideRef = useRef<CardSide>('front');
  const [current, setCurrent] = useState<CardSide>('front');
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  /** `flip`: the front is taken, and the card is to be turned before the back is scanned. */
  const [phase, setPhase] = useState<'scan' | 'flip'>('scan');
  const [frontShot, setFrontShot] = useState<string | null>(null);
  const open = side !== null;

  // Callbacks read through refs: the guide is attached once and calls back long after a render.
  const latest = useRef({ continueToBack, onPhoto, onClose });
  latest.current = { continueToBack, onPhoto, onClose };

  const stop = (): void => {
    guideRef.current?.stop();
    guideRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  };

  const take = (dataUrl: string): void => {
    const taken = sideRef.current;
    latest.current.onPhoto(taken, toFile(dataUrl, taken));
    if (taken === 'front' && latest.current.continueToBack) {
      // A pause between the sides: the guide stops (the camera stays on) and the person is shown
      // that the front is done and the card must be turned. Going on by itself, it took the back
      // before the card was turned — sometimes the front a second time.
      guideRef.current?.stop();
      setFrontShot(dataUrl);
      setPhase('flip');
    } else {
      stop();
      latest.current.onClose();
    }
  };

  /** From the pause: scan the given side now. */
  const scan = (next: CardSide): void => {
    sideRef.current = next;
    setCurrent(next);
    setPhase('scan');
    // The guide remembers the front it took and will not take it again as the back.
    guideRef.current?.start();
  };

  useEffect(() => {
    if (side === null) return undefined;
    let cancelled = false;
    sideRef.current = side;
    setCurrent(side);
    setFailed(false);
    setReady(false);
    setPhase('scan');
    setFrontShot(null);

    void (async () => {
      let stream: MediaStream;
      try {
        try {
          stream = await openStream(rearCamera);
        } catch (error) {
          if (rearCamera === null) throw error;
          rearCamera = null; // that camera is gone (phones renumber them): the default one
          stream = await openStream(null);
        }
        const guide = await loadGuide();
        if (rearCamera === null && guide !== null) {
          // Lens names are known once the camera is allowed: prefer the main lens.
          const main = guide.mainRearCamera(await navigator.mediaDevices.enumerateDevices());
          const now = stream.getVideoTracks()[0]?.getSettings().deviceId ?? null;
          rearCamera = main?.deviceId ?? now;
          if (main !== null && main.deviceId !== now) {
            try {
              const better = await openStream(main.deviceId);
              for (const track of stream.getTracks()) track.stop();
              stream = better;
            } catch {
              // keep the default lens
            }
          }
        }
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        void focusOn(stream);
        const video = videoRef.current;
        if (video === null) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        if (guide !== null) {
          for (const key of MESSAGE_KEYS)
            guide.MESSAGES[key] = t(`nationalIdOcr.camera.guide.${key}`);
          guideRef.current = guide.attach(video, {
            side: () => sideRef.current,
            onCapture: take,
            // One box on the screen: the frame. Its corners say how close the card is.
            showCard: false,
          });
          guideRef.current.start();
        }
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [side, locale]);

  /** The shutter: the framed card when the guide has found one, else the whole picture. */
  const shooting = useRef(false);
  const snap = (): void => {
    if (phase === 'flip' || shooting.current) return;
    const video = videoRef.current;
    if (video === null || video.videoWidth === 0) return;
    const guide = guideRef.current;
    if (guide !== null && guide.state?.card !== undefined && guide.state.card !== null) {
      if (guide.captureSharpest === undefined) {
        take(guide.capture());
        return;
      }
      shooting.current = true;
      void guide
        .captureSharpest()
        .then(take)
        .finally(() => {
          shooting.current = false;
        });
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    take(canvas.toDataURL('image/jpeg', 0.92));
  };

  const close = (): void => {
    stop();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t(
        current === 'front' ? 'nationalIdOcr.camera.titleFront' : 'nationalIdOcr.camera.titleBack',
      )}
      description={t('nationalIdOcr.camera.hint')}
      size="lg"
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t('nationalIdOcr.camera.cancel')}
          </Button>
          <Button
            onClick={snap}
            disabled={!ready || phase === 'flip'}
            className="min-h-[44px] px-6"
          >
            {t('nationalIdOcr.camera.snap')}
          </Button>
        </>
      }
    >
      {failed ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t('nationalIdOcr.camera.unavailable')}
        </p>
      ) : (
        <div className="relative mx-auto aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="h-full w-full object-contain"
            // A tap on the card focuses there, where the camera allows it.
            onClick={(event) => {
              const stream = streamRef.current;
              if (stream === null) return;
              const box = event.currentTarget.getBoundingClientRect();
              void focusOn(
                stream,
                (event.clientX - box.left) / box.width,
                (event.clientY - box.top) / box.height,
              );
            }}
          />
          {!ready && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
              {t('nationalIdOcr.camera.starting')}
            </p>
          )}
          {phase === 'flip' && (
            <FlipPrompt
              frontShot={frontShot}
              onBack={() => scan('back')}
              onRetakeFront={() => scan('front')}
            />
          )}
        </div>
      )}
    </Dialog>
  );
};
