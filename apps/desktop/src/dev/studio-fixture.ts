/**
 * Dev-only Studio frame fixture, "Stüdyo" (S91). StudioFixture.tsx renders it instead of the app shell with a
 * fake project list, a fake editor model and a silent transport; reachable only through `?fixture=S91` in
 * development builds. The arrangement region shows ST-ui-a's neutral placeholder.
 */
export const STUDIO_FIXTURE_VARIANTS = {
  S91: ['default', 'empty', 'loading', 'editor', 'readonly'],
} as const;
export type StudioFixtureVariant = (typeof STUDIO_FIXTURE_VARIANTS)['S91'][number];
