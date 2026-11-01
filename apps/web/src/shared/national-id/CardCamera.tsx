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

export type CardSide = 'front' | 'back';

interface Guide {
  start: () => void;
  stop: () => void;
  capture: () => string;
  readonly state: { card?: unknown } | null;
}

interface CaptureGuideApi {
  attach: (
    video: HTMLVideoElement,
    options: { side: () => CardSide; onCapture: (dataUrl: string) => void; auto?: boolean },
  ) => Guide;
  mainRearCamera: (devices: MediaDeviceInfo[]) => MediaDeviceInfo | null;
  MESSAGES: Record<string, string>;
}

declare global {
  interface Window {
    CaptureGuide?: CaptureGuideApi;
  }
}

/** The live camera needs https (or localhost) and a browser that offers it. */
export const liveCameraSupported = (): boolean =>
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  typeof navigator.mediaDevices?.getUserMedia === 'function';

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
const openStream = (deviceId: string | null): Promise<MediaStream> =>
  navigator.mediaDevices.getUserMedia({
    audio: false,
    video:
      deviceId === null
        ? { facingMode: 'environment', width: { ideal: 1920 } }
        : { deviceId: { exact: deviceId }, width: { ideal: 1920 } },
  });

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
      sideRef.current = 'back';
      setCurrent('back');
      // The guide remembers the front it took and will not take it again as the back.
      guideRef.current?.start();
    } else {
      stop();
      latest.current.onClose();
    }
  };

  useEffect(() => {
    if (side === null) return undefined;
    let cancelled = false;
    sideRef.current = side;
    setCurrent(side);
    setFailed(false);
    setReady(false);

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
        const video = videoRef.current;
        if (video === null) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        if (guide !== null) {
          for (const key of MESSAGE_KEYS)
            guide.MESSAGES[key] = t(`nationalIdOcr.camera.guide.${key}`);
          guideRef.current = guide.attach(video, { side: () => sideRef.current, onCapture: take });
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
  const snap = (): void => {
    const video = videoRef.current;
    if (video === null || video.videoWidth === 0) return;
    const guide = guideRef.current;
    if (guide !== null && guide.state?.card !== undefined && guide.state.card !== null) {
      take(guide.capture());
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
          <Button onClick={snap} disabled={!ready} className="min-h-[44px] px-6">
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
          />
          {!ready && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
              {t('nationalIdOcr.camera.starting')}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
};
