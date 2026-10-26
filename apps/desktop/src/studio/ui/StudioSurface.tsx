import type { ReactNode } from 'react';
import { BoardUiRoot } from '@boardui/foundations/root';

/** BoardUI region + page background shared by every Studio screen. */
export function StudioSurface({ children }: { children: ReactNode }) {
  return (
    <BoardUiRoot>
      <div className="flex h-full min-h-0 flex-1 flex-col bg-background-full text-text-primary">
        {children}
      </div>
    </BoardUiRoot>
  );
}
