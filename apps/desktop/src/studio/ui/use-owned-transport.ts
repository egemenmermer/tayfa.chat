import { useEffect, useState } from 'react';
import type { StudioTransport } from './transport';

/**
 * A transport owned by the mounted component: created in an effect and disposed by that effect's cleanup, so
 * StrictMode's simulated unmount disposes one instance and the remount gets a fresh one (a memoized instance
 * would stay disposed and every Play would fail). Null until the effect has run.
 */
export function useOwnedTransport(create: () => StudioTransport): StudioTransport | null {
  const [transport, setTransport] = useState<StudioTransport | null>(null);
  useEffect(() => {
    const created = create();
    setTransport(created);
    return () => {
      created.dispose();
      setTransport((current) => (current === created ? null : current));
    };
  }, [create]);
  return transport;
}
