// Where a browser fetches a stored file's bytes from.
//
// Its own module because the CHOICE it makes is the whole point, and that choice is not obvious
// from the call site: same-origin deployments must get a relative URL, split ones an absolute one,
// and getting it wrong fails in a way nothing on the server can see.
export const signedFileUrl = (input: {
  fileId: string;
  expiresAtEpoch: number;
  signature: string;
  /** Subpath deployments (`BASE_PATH`); `''` at the root. */
  basePath: string;
  /** Absolute base of the api — used only when the web app is served from somewhere else. */
  apiPublicUrl: string;
  /**
   * True when this process ALSO serves the web app. The browser is then already on this origin,
   * so a path resolves to exactly the right place and no configured origin can contradict it.
   *
   * That matters because the app's Content-Security-Policy matches origins byte for byte:
   * `localhost` and `127.0.0.1`, `http` and `https`, apex and `www` are different origins to it.
   * An absolute URL that is merely *equivalent* to the one the user is browsing — or, on a default
   * install, still pointing at localhost — makes the browser refuse every stored image, and the
   * server sees no request, no error and no log line.
   */
  servesWebApp: boolean;
}): string => {
  const origin = input.servesWebApp ? '' : input.apiPublicUrl;
  const query = `e=${input.expiresAtEpoch}&s=${input.signature}`;
  return `${origin}${input.basePath}/api/v1/platform/files/signed/${input.fileId}?${query}`;
};
