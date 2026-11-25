import { createHash } from 'node:crypto';

export interface IdentityCache<T> {
  (token: string): Promise<T>;
  /** Drops a token at once, e.g. after Stoat answered 401 for it. */
  forget(token: string): void;
  clear(): void;
}

/**
 * Remembers whom a session token belongs to for a short time.
 *
 * Every service request used to ask Stoat `/users/@me`. Stoat's rate limit counts those calls
 * per container, so access, activities and cinema each shared one small bucket among all
 * users; polling and the 10 s membership sweep kept it full, and every click then waited for
 * the window to reset (up to 10 s). Only the identity is remembered: membership and
 * permissions are still read fresh on each request. A signed-out session therefore keeps
 * passing the identity step for at most `ttlMs`.
 *
 * Concurrent lookups for one token share a single call; failures are never remembered.
 * Keys are SHA-256 digests, so the raw token is not kept as a map key.
 */
export function identityCache<T>(
  lookup: (token: string) => Promise<T>,
  options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {},
): IdentityCache<T> {
  const ttl = options.ttlMs ?? 30_000;
  const max = Math.max(1, options.maxEntries ?? 2000);
  const now = options.now ?? Date.now;
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  const keyOf = (token: string) => createHash('sha256').update(token).digest('base64url');
  const resolve = ((token: string) => {
    const key = keyOf(token);
    const current = now();
    const hit = entries.get(key);
    if (hit && current - hit.at < ttl) return hit.value;
    entries.delete(key);
    const value = lookup(token);
    const entry = { at: current, value };
    entries.set(key, entry);
    value.catch(() => {
      if (entries.get(key) === entry) entries.delete(key);
    });
    // Map order is insertion order and a refresh re-inserts, so the first key is the oldest.
    while (entries.size > max) entries.delete(entries.keys().next().value!);
    return value;
  }) as IdentityCache<T>;
  resolve.forget = (token) => void entries.delete(keyOf(token));
  resolve.clear = () => entries.clear();
  return resolve;
}
