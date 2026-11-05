import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// UI-T10/T11 (UI-51, DS-7): the media, agent, DJ and cinema stylesheets sit on the type floor and
// take their accent from the tokens, so the Settings accent picker reaches them. jsdom cannot
// resolve the cascade, so these guards read the CSS text.
const src = path.resolve(__dirname, '../apps/desktop/src');
const files = [
  'reference-media.css',
  'reference-agent.css',
  'reference-agent-task.css',
  'reference-agent-automation.css',
  'reference-agent-management.css',
  'music-dj.css',
  'reference-inset-player.css',
  'reference-mini-playback.css',
  'cinema/community-cinema.css',
  'cinema/hall-sidebar.css',
  'cinema/hall-background.css',
  'cinema/cinema-reminders.css',
  'cozy-cinema.css',
];
const read = (file: string) =>
  readFileSync(path.join(src, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const floor = 11;

describe('type floor and accent tokens in media, agent and cinema CSS', () => {
  it('has no font-size below the 11px floor', () => {
    for (const file of files) {
      const css = read(file);
      const sizes = [
        ...[...css.matchAll(/font-size:\s*(\d*\.?\d+)(px|rem|em)/g)].map((m) => [m[1], m[2]]),
        // `font:` shorthand, optionally led by a weight, a keyword or a weight variable.
        ...[
          ...css.matchAll(
            /\bfont:\s*(?:(?:\d{3}|bold|italic|normal|var\(--[\w-]+\))\s+)*(\d*\.?\d+)(px|rem|em)/g,
          ),
        ].map((m) => [m[1], m[2]]),
      ];
      for (const [value, unit] of sizes) {
        const px = unit === 'px' ? Number(value) : Number(value) * 14;
        expect(px, `${file}: ${value}${unit}`).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('hard-codes no lilac accent; the accent tokens carry it', () => {
    for (const file of files) {
      const css = read(file);
      expect(css, file).not.toMatch(/#8b83ff/i);
      expect(css, file).not.toMatch(/rgba?\(\s*139[\s,]+131[\s,]+255/i);
      expect(css, file).not.toMatch(/var\(--(?:accent|color-accent-primary),/);
    }
  });

  it('derives the cinema accent tints from the accent token', () => {
    const css = read('cinema/hall-sidebar.css');
    for (const name of ['soft', 'cell'])
      expect(css).toMatch(
        new RegExp(`--cinema-accent-${name}:\\s*color-mix\\([^;]*var\\(--color-action-primary\\)`),
      );
  });
});
