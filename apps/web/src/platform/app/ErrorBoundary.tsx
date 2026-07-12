// Top-level React error boundary: catches render-time crashes so a single broken screen never
// blanks the whole app. Async/data errors are handled by TanStack Query + toasts; this covers
// the synchronous render path. The default fallback is localized and offers reset + reload.
import { Component, type ReactNode } from 'react';
import { useT } from '../localization/useT';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  message: string | null;
}

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
  override state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  private readonly reset = (): void => this.setState({ hasError: false, message: null });

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return this.props.fallback ?? <DefaultFallback message={this.state.message} onReset={this.reset} />;
  }
}
