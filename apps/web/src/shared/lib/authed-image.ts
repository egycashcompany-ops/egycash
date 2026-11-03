// A private image, ready for an `<img src>`.
//
// An `<img>` cannot send the bearer token a private picture needs, so the bytes come through
// `fetchBlob` and the page gets an object URL. The BYTES live in the query cache — one download
// however many places show the picture (the top bar and the welcome page show the same face) —
// while each caller owns its own object URL and revokes it when it goes away.
//
// The KEY is the picture's version (its file id), and lives apart from the record it belongs to:
// a changed photo is a new key, so nothing ever refetches the old one — and a refresh of the
// employee's data does not download a 5 MB image again. A picture that is gone (404) is the answer
// «no picture», never an error toast.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, fetchBlob } from './api-client';

/**
 * A picture uploaded a moment ago may still be with the virus scanner, which answers 422 until it
 * is done. That is a wait, not a refusal: ask again a few times, a few seconds apart.
 */
const stillScanning = (failures: number, error: unknown): boolean =>
  failures < 5 && error instanceof ApiError && error.status === 422;

export const useAuthedImage = (
  path: string | null,
  queryKey: readonly unknown[],
): { url: string | null; loading: boolean } => {
  const image = useQuery({
    queryKey,
    queryFn: async (): Promise<Blob | null> => {
      try {
        return await fetchBlob(path ?? '');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: path !== null,
    staleTime: 10 * 60_000,
    // A missing picture is an answer, not an outage: the initial stands in. Only a scan in progress
    // is worth asking again.
    retry: stillScanning,
    retryDelay: 3_000,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (image.data === undefined || image.data === null || path === null) {
      setUrl(null);
      return undefined;
    }
    const made = URL.createObjectURL(image.data);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [image.data, path]);
  return { url, loading: path !== null && image.isPending };
};
