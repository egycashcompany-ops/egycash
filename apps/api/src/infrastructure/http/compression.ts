// Response compression — gzip or brotli, for whatever the browser accepts.
//
// The api answers in JSON and serves the web bundle, and both shrink to a fraction of their size:
// an employee list page or a 1 MB script is mostly repeated keys and identifiers. Until this, the
// process sent every response at full size, and Railway's edge — documented as terminating TLS,
// adding headers and routing — is not where compression is configured. On a phone over a mobile
// connection the transfer is most of the wait.
//
// WHAT IS NEVER COMPRESSED, and why:
//   - the auth routes. Their bodies carry the access token and the TOTP enrolment secret, and a
//     compressed secret next to text a request can influence is what BREACH reads, byte by byte,
//     from response sizes alone. They are small and rare; compressing them buys nothing.
//   - a request with a Range header. A partial response is a slice of the file's own bytes, and
//     compressing the slice breaks the promise its Content-Range makes.
//   - server-sent events, which must reach the browser as each one is written, not when a
//     compression buffer fills.
//   - anything already compressed (images, PDFs, spreadsheets, zips) and anything under 1 KB —
//     the library's own content-type check and the threshold below.
import compression from 'compression';
import type { Request, RequestHandler, Response } from 'express';

/** Below this, the headers and the CPU cost more than the bytes saved. */
export const COMPRESSION_THRESHOLD_BYTES = 1024;

/**
 * The auth routes, under whatever prefix the deployment serves the api from. Express also sends
 * `/API/v1/Auth/login` and `/api/v1//auth/login` to the auth router (its matching ignores case,
 * and the mount accepts a doubled slash), so both sides are lowercased and repeated slashes
 * collapsed before comparing. Reading a path as auth when Express would not only means it is
 * sent uncompressed.
 */
export const isAuthPath = (pathname: string, basePath: string): boolean => {
  const normalise = (path: string): string => path.toLowerCase().replace(/\/{2,}/g, '/');
  const auth = normalise(`${basePath}/api/v1/auth`);
  const path = normalise(pathname);
  return path === auth || path.startsWith(`${auth}/`);
};

/** Decided when the response's headers are written: its content type is known by then. */
export const mayCompress = (req: Request, res: Response): boolean => {
  if (req.headers.range !== undefined) return false;
  const type = String(res.getHeader('Content-Type') ?? '');
  if (type.startsWith('text/event-stream')) return false;
  return compression.filter(req, res);
};

export const responseCompression = (basePath: string): RequestHandler => {
  const compress = compression({ threshold: COMPRESSION_THRESHOLD_BYTES, filter: mayCompress });
  // The path is checked HERE, on the way in, where `req.path` is still the full path: by the time
  // a response is written, the router it went through has rewritten `req.url` relative to its
  // mount point, and `/api/v1/auth/login` reads as `/login`.
  return (req, res, next) => {
    if (isAuthPath(req.path, basePath)) {
      next();
      return;
    }
    compress(req, res, next);
  };
};
