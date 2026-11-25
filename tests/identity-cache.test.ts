import { describe, expect, it, vi } from 'vitest';
import { identityCache } from '../apps/services/shared/identity-cache';

// Services asked Stoat `/users/@me` on every request; the container-wide rate limit then made
// clicks wait for its 10 s window. These guard the cache that keeps that to one call per token.
describe('identityCache', () => {
  const user = (id: string) => ({ id });

  it('asks Stoat once per token within the time to live', async () => {
    let now = 0;
    const lookup = vi.fn(async (token: string) => user(`u-${token}`));
    const identify = identityCache(lookup, { ttlMs: 30_000, now: () => now });
    expect(await identify('a')).toEqual({ id: 'u-a' });
    now = 29_999;
    expect(await identify('a')).toEqual({ id: 'u-a' });
    expect(lookup).toHaveBeenCalledTimes(1);
    now = 30_000;
    await identify('a');
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('keeps tokens apart', async () => {
    const lookup = vi.fn(async (token: string) => user(`u-${token}`));
    const identify = identityCache(lookup);
    expect(await identify('a')).toEqual({ id: 'u-a' });
    expect(await identify('b')).toEqual({ id: 'u-b' });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('shares one call between concurrent requests', async () => {
    let release!: (value: { id: string }) => void;
    const lookup = vi.fn(() => new Promise<{ id: string }>((resolve) => (release = resolve)));
    const identify = identityCache(lookup);
    const first = identify('a'),
      second = identify('a');
    release(user('u-a'));
    expect(await Promise.all([first, second])).toEqual([{ id: 'u-a' }, { id: 'u-a' }]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('never remembers a failure', async () => {
    const lookup = vi
      .fn<(token: string) => Promise<{ id: string }>>()
      .mockRejectedValueOnce(new Error('401'))
      .mockResolvedValueOnce(user('u-a'));
    const identify = identityCache(lookup);
    await expect(identify('a')).rejects.toThrow('401');
    expect(await identify('a')).toEqual({ id: 'u-a' });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('forgets a token Stoat rejected later', async () => {
    const lookup = vi.fn(async (token: string) => user(`u-${token}`));
    const identify = identityCache(lookup);
    await identify('a');
    identify.forget('a');
    await identify('a');
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('stays bounded and drops the oldest token first', async () => {
    const lookup = vi.fn(async (token: string) => user(`u-${token}`));
    const identify = identityCache(lookup, { maxEntries: 2 });
    await identify('a');
    await identify('b');
    await identify('c');
    await identify('b');
    expect(lookup).toHaveBeenCalledTimes(3);
    await identify('a');
    expect(lookup).toHaveBeenCalledTimes(4);
  });
});
