// An owner's logo, or its initial when it has none.
//
// A stored file is not addressable by URL — it needs a download ticket — so this goes through the
// platform's `useFileTicket` rather than pointing an <img> at an API path that would 401.
import { useFileTicket } from '../../../shared/lib/file-ticket';

export const CompanyLogo = ({
  fileId,
  name,
  size = 40,
}: {
  fileId: string | null;
  name: string;
  size?: number;
}): JSX.Element => {
  const ticket = useFileTicket(fileId);
  const url = ticket.data?.url;
  const style = { width: size, height: size };

  if (fileId !== null && url !== undefined) {
    return (
      <img
        src={url}
        alt=""
        style={style}
        className="rounded-lg border border-slate-200 object-cover dark:border-slate-700"
      />
    );
  }
  return (
    <span
      style={style}
      className="grid place-items-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300"
    >
      {name.slice(0, 1)}
    </span>
  );
};
