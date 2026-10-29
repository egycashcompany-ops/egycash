// The platform's version as the repository declares it — `package.json`, the number the web app
// shows in its user menu — so anything the server stamps with a version (a generated contract's
// integrity line) names the same release as the screen. The bundler inlines it at build time;
// nothing is read from disk at runtime.
import { version } from '../../../package.json';

/** e.g. «2.2.0». */
export const APP_VERSION: string = version;
