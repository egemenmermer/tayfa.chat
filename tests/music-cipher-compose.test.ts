import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const fragment = readFileSync(join(__dirname, '../infra/music-compose.fragment.yml'), 'utf8');
const cipher = fragment.slice(fragment.indexOf('\n  music-cipher:'));
const tmpfsSize = (path: string): number | null => {
  const line = new RegExp(`- ${path.replace(/\./g, '\\.')}:(\\S+)`).exec(cipher)?.[1];
  const size = line && /size=(\d+)/.exec(line)?.[1];
  return size ? Number(size) : null;
};

describe('music-cipher compose defaults', () => {
  it('defines the cipher service the DJ bridge calls', () => {
    expect(cipher).toMatch(/^ {2}music-cipher:/m);
    expect(cipher).toMatch(/image: ghcr\.io\/kikkia\/yt-cipher@sha256:[0-9a-f]{64}/);
  });

  // yt-cipher saves one ~3 MB player script per YouTube release and never prunes while running.
  // 64 MB filled in five weeks and made every add-song request fail with ENOSPC.
  it('keeps room for at least 6 months of player scripts in the cache tmpfs', () => {
    const size = tmpfsSize('/home/nonroot/.cache');
    expect(size).not.toBeNull();
    expect(size!).toBeGreaterThanOrEqual(192 * 1024 * 1024);
  });

  it('keeps the cache inside the container memory limit with room for the process', () => {
    const limit = Number(/mem_limit: (\d+)m/.exec(cipher)?.[1]) * 1024 * 1024;
    const tmp = tmpfsSize('/tmp') ?? 0;
    const cache = tmpfsSize('/home/nonroot/.cache') ?? 0;
    // The service uses about 275 MB; keep the full tmpfs total below the limit minus that.
    expect(tmp + cache + 300 * 1024 * 1024).toBeLessThanOrEqual(limit);
  });

  it('stays unprivileged and read-only', () => {
    expect(cipher).toMatch(/read_only: true/);
    expect(cipher).toMatch(/cap_drop:\s*\n\s+- ALL/);
    expect(cipher).toMatch(/no-new-privileges:true/);
  });
});
