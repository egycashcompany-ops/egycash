// Top-level React error boundary: catches render-time crashes so a single broken screen never
// blanks the whole app. Async/data errors are handled by TanStack Query + toasts; this covers
// the synchronous render path. The default fallback is localized and offers reset + reload.
//
// One error is not a crash: a chunk of an OLDER build that a deploy has since removed. For that
// the page reloads itself into the current build (`stale-build.ts`) and says so meanwhile, rather
// than showing a scary message for something the person did not do and cannot fix.
import { Component, type ReactNode } from 'react';
import { useT } from '../localization/useT';
import { Spinner } from '../../shared/ui/Spinner';
import { isStaleBuildError, reloadIntoNewBuild } from './stale-build';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  message: string | null;
  /** The failure was a chunk of an older build, and a reload into the current one is under way. */
  staleBuild: boolean;
}

/** Shown for the moment between noticing an older build and the page reloading into the new one. */
const UpdatingNotice = (): JSX.Element => {
  const t = useT();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center dark:bg-slate-950">
      <Spinner className="h-6 w-6 text-brand-600" />
      <div className="max-w-md">
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {t('common.staleBuild.title')}
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t('common.staleBuild.body')}</p>
      </div>
    </div>
  );
};

const DefaultFallback = ({ message, onReset }: { message: string | null; onReset: () => void }): JSX.Element => {
  const t = useT();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center dark:bg-slate-950">
      <div className="max-w-md">
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {t('common.errorBoundary.title')}
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {t('common.errorBoundary.body')}
        </p>
        {message !== null && (
          <p className="mt-2 break-words font-mono text-xs text-slate-400" dir="ltr">
            {message}
          </p>
        )}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {t('common.retry')}
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {t('common.errorBoundary.reload')}
        </button>
      </div>
    </div>
  );
};

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, message: null, staleBuild: false };

  static getDerivedStateFromError(error: Error): State {
    // Assumed to be on its way to a reload from the first render, so the error screen never
    // flashes up in front of it; `componentDidCatch` withdraws the assumption if the reload is
    // refused.
    return { hasError: true, message: error.message, staleBuild: isStaleBuildError(error) };
  }

  override componentDidCatch(error: Error): void {
    // Refused means a reload already happened moments ago and the chunk is STILL missing — the
    // current build is broken, not this tab. The ordinary screen and its reload button, then.
    if (isStaleBuildError(error) && !reloadIntoNewBuild()) this.setState({ staleBuild: false });
  }

  private readonly reset = (): void =>
    this.setState({ hasError: false, message: null, staleBuild: false });

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.state.staleBuild) return <UpdatingNotice />;
    return this.props.fallback ?? <DefaultFallback message={this.state.message} onReset={this.reset} />;
  }
}
