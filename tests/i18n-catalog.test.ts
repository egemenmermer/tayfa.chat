import { expect, it } from 'vitest';
import { placeholders, type CatalogMessage } from '../packages/i18n/src/index';
import { en, enGroups } from '../apps/desktop/src/locales/en';
import { errorMessages } from '../apps/desktop/src/i18n';
import { activityMessages } from '../apps/desktop/src/messages.tr';
// @ts-expect-error The scanner is a plain ESM script shared with scripts/i18n-scan.mjs.
import { extract, looksTurkish, sourceFiles } from '../scripts/i18n-extract.mjs';

interface Extracted {
  calls: { key: string; line: number; name: string }[];
  literals: Set<string>;
}
const scanned = (sourceFiles() as string[]).map((file) => ({
  file,
  ...(extract(file) as Extracted),
}));
// Turkish that legacy tr() keys and server error codes resolve through the catalog.
const indirectSources = [
  ...Object.values(errorMessages),
  ...Object.entries(activityMessages)
    .filter(([key, value]) => key === value)
    .map(([key]) => key),
];
const texts = (message: CatalogMessage) =>
  typeof message === 'string' ? [message] : [message.one, message.other];

it('has English for every Turkish message the code asks for', () => {
  const missing = [
    ...scanned.flatMap(({ file, calls }) =>
      calls
        .filter(({ key, name }) => (name === 't' || looksTurkish(key)) && !Object.hasOwn(en, key))
        .map(({ key, line }) => `${file}:${line} ${key}`),
    ),
    ...indirectSources.filter((key) => !Object.hasOwn(en, key)),
  ];
  expect(missing).toEqual([]);
}, 60_000);

it('keeps placeholders and wording consistent across catalog groups', () => {
  const problems: string[] = [];
  const seen = new Map<string, { group: string; message: CatalogMessage }>();
  for (const [group, catalog] of Object.entries(enGroups))
    for (const [source, message] of Object.entries(catalog)) {
      const previous = seen.get(source);
      if (previous && JSON.stringify(previous.message) !== JSON.stringify(message))
        problems.push(`${group} and ${previous.group} translate "${source}" differently`);
      seen.set(source, { group, message });
      if (texts(message).some((text) => !text.trim())) problems.push(`empty: ${source}`);
      const expected = placeholders(source);
      const actual = placeholders(message);
      if (actual.some((name) => !expected.includes(name)))
        problems.push(`unknown placeholder in "${source}"`);
      const other = typeof message === 'string' ? message : message.other;
      if (expected.some((name) => !placeholders(other).includes(name)))
        problems.push(`dropped placeholder in "${source}"`);
      const turkish = texts(message).find((text) =>
        /[çğıöşüÇĞİÖŞÜ]/.test(text.replace(/Türkçe|Tayfa'?/g, '')),
      );
      if (turkish) problems.push(`Turkish left in the English for "${source}": ${turkish}`);
    }
  expect(problems).toEqual([]);
});

it('has no catalog entries that the code no longer uses', () => {
  // Service messages reach the window as error text and are translated by uiError.
  const services = (sourceFiles(['apps/services']) as string[]).map(
    (file) => (extract(file) as Extracted).literals,
  );
  const used = new Set([
    ...[...scanned.map(({ literals }) => literals), ...services].flatMap((set) => [...set]),
    ...indirectSources,
  ]);
  expect(Object.keys(en).filter((source) => !used.has(source))).toEqual([]);
}, 60_000);
