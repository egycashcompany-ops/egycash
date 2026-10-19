// The custody papers on screen — each A4 sheet as the licence memo's view draws it.
//
// `PaperSheet` is one sheet at 0.8, white in both themes, never wider than the room it has: on a
// phone the whole page shows, smaller, instead of its right half. `PaperTray` is the grey tray of
// a paper's sheets, one under the other — a fuel memo that runs on shows its two or three pages.
// The sheets are the very HTML the print window receives (`lib/custody-papers.ts`), injected as
// they are: each carries its own scoped `<style>`, and every user value in it is escaped.
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../shared/lib/cn';
import { paperFontsReady } from '../lib/custody-papers';

/** 210mm in CSS pixels — the sheet's own width. */
const SHEET_PX = (210 / 25.4) * 96;
/** The licence memo's view zoom — the most a sheet is ever drawn at. */
const ZOOM = 0.8;

/**
 * True once the papers' faces are registered — a paper drawn before then only estimates how small
 * Excel's «shrink to fit» makes a long line. Callers memoise their sheets on it, so the paper is
 * drawn again, measured, when it turns true.
 */
export const usePaperFonts = (): boolean => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void paperFontsReady().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);
  return ready;
};

/** One A4 sheet at 0.8 — or smaller, to fit a narrow screen. */
export const PaperSheet = ({ html, mark }: { html: string; mark?: string }): JSX.Element => {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(ZOOM);
  useEffect(() => {
    const el = box.current;
    if (el === null) return undefined;
    const fit = (): void => {
      if (el.clientWidth > 0) setZoom(Math.min(ZOOM, el.clientWidth / SHEET_PX));
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return (
    <div
      ref={box}
      className="mx-auto w-[640px] max-w-full overflow-hidden rounded bg-white shadow-xl"
      data-paper-page={mark ?? ''}
    >
      <div
        className="origin-top-right"
        style={{ zoom, width: '210mm' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
};

/** A paper's sheets on the grey tray, one under the other. */
export const PaperTray = ({
  sheets,
  name,
  bare = false,
  className,
}: {
  sheets: readonly string[];
  /** Marks each sheet `data-paper-page="<name>:<n>"`. */
  name?: string;
  /** Inside something already grey (the set-up's preview column): no tray of its own. */
  bare?: boolean;
  /** E.g. a dialog's `max-h-… overflow-auto`. */
  className?: string;
}): JSX.Element => {
  // The faces the sheets name are registered with the page, whoever drew the sheets.
  usePaperFonts();
  return (
    <div
      className={cn(
        'space-y-4',
        !bare && 'rounded-lg bg-slate-200 p-3 dark:bg-slate-800',
        className,
      )}
      data-paper-tray={name ?? ''}
    >
      {sheets.map((html, index) => (
        <PaperSheet
          key={index}
          html={html}
          mark={name === undefined ? String(index + 1) : `${name}:${index + 1}`}
        />
      ))}
    </div>
  );
};
