import { defineConfig } from 'vitest/config';

// The web suite covers the cache layer — what a server response does to the query cache — which is
// plain data manipulation over a real QueryClient and needs no DOM.
//
// Components are still not tested as React: no jsdom, no testing-library, no clicking. The one
// thing a component may be rendered for is a CONTRACT assertion the data layer cannot make on its
// own — chiefly "this component asks for a translation key that exists", after a badge shipped a
// raw `interviews.status.waiting` to users. `renderToStaticMarkup` is enough for that and keeps
// the environment `node`, so `.spec.tsx` is included for exactly that narrow purpose.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    environment: 'node',
    reporters: ['default', 'hanging-process'],
  },
});
