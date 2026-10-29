/** Types for scripts/windows-update-feed.mjs (used by tests). */
export function updateFeed(value: string | undefined): string;
export function installerName(version: string): string;
export function parseLatestYml(text: string): Record<string, unknown>;
export function latestYmlProblems(
  info: Record<string, unknown>,
  expected: { version: string; installer: string; sha512: string; size: number },
): string[];
export function sha512Base64(bytes: Uint8Array): string;
