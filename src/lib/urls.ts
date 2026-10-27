import { env } from "./env";

/** Build-time sub-path the app is served under ("" at the site root). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Prefixes an app path for plain <a href> links. Next's <Link>, redirect() and
 * router already add the base path; plain anchors (used for API routes that
 * redirect off-site) do not.
 */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}

/**
 * Absolute public URL for an app path, for emails, OAuth callbacks and
 * server redirects. APP_URL is the full public URL including the base path,
 * e.g. https://www.yuchaotao.com/game-vote.
 */
export function absoluteUrl(path: string): string {
  return `${env().APP_URL.replace(/\/+$/, "")}${path}`;
}
