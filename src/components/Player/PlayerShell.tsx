import type { ReactNode } from 'react';

/** The footer slab shared by the full player bar and the game-mode bar. */
export const PlayerShell = ({ children }: { children: ReactNode }) => (
  <footer className="neu-raised-top relative z-player h-[var(--player-bar-height)] px-5 py-2">{children}</footer>
);
