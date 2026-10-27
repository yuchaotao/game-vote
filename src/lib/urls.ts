import { env } from "./env";

export { BASE_PATH, withBase } from "./base-path";

/**
 * Absolute public URL for an app path, for emails, OAuth callbacks and
 * server redirects. APP_URL is the full public URL including the base path,
 * e.g. https://www.yuchaotao.com/game-vote.
 */
export function absoluteUrl(path: string): string {
  return `${env().APP_URL.replace(/\/+$/, "")}${path}`;
}
