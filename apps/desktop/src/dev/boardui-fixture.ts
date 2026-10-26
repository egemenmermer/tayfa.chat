/**
 * Dev-only BoardUI gallery, "BoardUI · Tayfa renkleri" (S90). BoardUiFixture.tsx renders it instead
 * of the app shell; it is reachable only through `?fixture=S90` in development builds.
 */
export const BOARDUI_FIXTURE_VARIANTS = { S90: ['default', 'overlays'] } as const;
export type BoardUiFixtureVariant = (typeof BOARDUI_FIXTURE_VARIANTS)['S90'][number];
