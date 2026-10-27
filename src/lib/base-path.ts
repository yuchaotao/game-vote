// Safe for client components (no server-only imports).

/** Build-time sub-path the app is served under ("" at the site root). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Prefixes an app path for plain <a href> links and browser APIs such as
 * EventSource. Next's <Link>, redirect() and router already add the base path.
 */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}
