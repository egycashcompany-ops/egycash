// A private image, ready for an `<img src>`.
//
// An `<img>` cannot send the bearer token a private picture needs, so the bytes come through
// `fetchBlob` and the page gets an object URL. The BYTES live in the query cache — one download
// however many places show the picture (the top bar and the welcome page show the same face) —
// while each caller owns its own object URL and revokes it when it goes away.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBlob } from './api-client';

export const useAuthedImage = (
  path: string | null,
  queryKey: readonly unknown[],
): { url: string | null; loading: boolean } => {
  const image = useQuery({
    queryKey,
    queryFn: () => fetchBlob(path ?? ''),
    enabled: path !== null,
    staleTime: 10 * 60_000,
    // A missing picture is an answer, not an outage: the initial or the silhouette stands in.
    retry: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (image.data === undefined || path === null) {
      setUrl(null);
      return undefined;
    }
    const made = URL.createObjectURL(image.data);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [image.data, path]);
  return { url, loading: path !== null && image.isPending };
};
