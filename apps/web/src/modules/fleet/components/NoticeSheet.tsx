// The insurer's form with the notice written on it — every page, one under the other.
//
// The pages are what the print copies (see `printNoticePages`), so the preview IS the print: the
// same markup, the same fitting, the same positions.
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { cn } from '../../../shared/lib/cn';
import { fitNotice, noticePageMarkup, NOTICE_CSS, type NoticeAnswers } from '../lib/notice-render';
import { type NoticeTemplate } from '../lib/notice-templates';

export const NoticeSheet = ({
  template,
  answers,
  focus,
  blank = false,
  pagesRef,
}: {
  template: NoticeTemplate;
  answers: NoticeAnswers;
  /** The box being typed in — marked on the page as well as in the form. */
  focus?: string | undefined;
  /** Show the answers alone, the way «على الورقة المطبوعة» prints them. */
  blank?: boolean;
  /** Receives the rendered pages, for printing. */
  pagesRef?: MutableRefObject<HTMLElement[]>;
}): JSX.Element => {
  const root = useRef<HTMLDivElement>(null);
  const markup = useMemo(
    () => template.pages.map((_, page) => noticePageMarkup(template, page, answers, focus)),
    [template, answers, focus],
  );

  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) return;
    if (pagesRef !== undefined) {
      pagesRef.current = [...element.querySelectorAll<HTMLElement>('[data-notice-page]')];
    }
    fitNotice(element);
    // A web font arriving late changes every width; fit again once the fonts are in.
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) fitNotice(element);
    });
    return () => {
      live = false;
    };
  }, [markup, pagesRef]);

  return (
    <div ref={root} className="flex w-full flex-col items-center gap-4">
      <style>{NOTICE_CSS}</style>
      {template.pages.map((src, page) => (
        <div
          key={src}
          data-notice-page={page}
          className={cn(
            'nt-page w-full max-w-[640px] shadow ring-1 ring-slate-300',
            blank && 'nt-blank',
          )}
        >
          <img src={src} alt="" draggable={false} />
          <div className="nt-over" dangerouslySetInnerHTML={{ __html: markup[page] ?? '' }} />
        </div>
      ))}
    </div>
  );
};
