import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const css = (name: string) => readFileSync(join(__dirname, '../apps/desktop/src', name), 'utf8');
const tokens = css('reference-tokens.css');
const token = (name: string) => {
  const value = new RegExp(`--${name}:\\s*(\\d+);`).exec(tokens)?.[1];
  if (!value) throw new Error(`missing token --${name}`);
  return Number(value);
};
/** Resolves the z-index forms these files use: a number, var(--z-x) or calc(var(--z-x) ± n). */
const zIndex = (source: string, selector: string) => {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing rule ${selector}`);
  const body = source.slice(start, source.indexOf('}', start));
  const value = /z-index:\s*([^;]+);/.exec(body)?.[1]?.trim();
  if (!value) throw new Error(`no z-index in ${selector}`);
  const calc = /^calc\(var\(--([\w-]+)\)\s*([+-])\s*(\d+)\)$/.exec(value);
  if (calc) return token(calc[1]!) + (calc[2] === '+' ? 1 : -1) * Number(calc[3]);
  const variable = /^var\(--([\w-]+)\)$/.exec(value);
  return variable ? token(variable[1]!) : Number(value);
};

// kaansut, 2026-11-15: picking a photo in Settings did nothing until another page was opened.
// The crop dialog lives at the app root, so it must sit above the fixed Settings surface.
it('shows the avatar crop dialog above the Settings surface', () => {
  const settings = zIndex(css('reference-settings.css'), '.settings-reference-surface');
  const crop = zIndex(css('avatar-crop.css'), '.modal-backdrop:has(> .modal.avatar-crop)');
  const modal = zIndex(css('styles.css'), '.modal-backdrop');
  expect(modal).toBeLessThan(settings);
  expect(crop).toBeGreaterThan(settings);
  expect(crop).toBeLessThan(token('z-popover'));
});
