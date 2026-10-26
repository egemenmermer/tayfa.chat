import type { ReactNode } from 'react';
import { UNSAFE_PortalProvider } from 'react-aria';

/**
 * A BoardUI region. BoardUI utilities apply only inside `[data-boardui]` (see globals.css), so every
 * BoardUI surface renders inside one; React Aria overlays (menus, select lists, tooltips) portal into a
 * matching region on document.body.
 *
 * The wrapper uses `display: contents`, so it adds no box. `theme` scopes a theme switch
 * (`[data-theme]`); Tayfa is dark by default, light is a preview only (theme.css).
 */
export type BoardUiTheme = 'dark' | 'light';

const portalRegions = new Map<string, HTMLElement>();

function portalRegion(theme: BoardUiTheme | undefined): HTMLElement {
  const key = theme ?? 'inherit';
  const existing = portalRegions.get(key);
  if (existing?.isConnected) return existing;
  const region = document.createElement('div');
  region.dataset.boardui = 'portal';
  if (theme) region.dataset.theme = theme;
  document.body.append(region);
  portalRegions.set(key, region);
  return region;
}

export function BoardUiRoot({ theme, children }: { theme?: BoardUiTheme; children: ReactNode }) {
  return (
    <div data-boardui="" data-theme={theme} style={{ display: 'contents' }}>
      <UNSAFE_PortalProvider getContainer={() => portalRegion(theme)}>
        {children}
      </UNSAFE_PortalProvider>
    </div>
  );
}
