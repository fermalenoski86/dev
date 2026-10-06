'use client';

import { useEffect } from 'react';
import { Viewport } from '../components/Viewport';
import { TransportBar } from '../components/TransportBar';
import { Inspector } from '../components/Inspector';
import { useShowStore } from '../state/useShowStore';

export default function Page() {
  const loadShow = useShowStore((s) => s.loadShow);
  const show = useShowStore((s) => s.show);

  useEffect(() => {
    // Show demo por defecto. Offline: se sirve del propio bundle.
    fetch('/shows/mcdonalds_takeover_001.json')
      .then((r) => r.json())
      .then(loadShow)
      .catch(() => undefined);
  }, [loadShow]);

  return (
    <main className="flex h-screen flex-col bg-neutral-950 text-neutral-200">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <span className="font-semibold tracking-[0.2em] text-amber-400">TRUST PREVIS</span>
        <span className="text-xs text-neutral-600">digital twin · v0.1</span>
        <span className="ml-auto text-xs text-neutral-500">
          {show ? show.name : 'sin show'}
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <Viewport />
        </div>
        <Inspector />
      </div>
      <TransportBar />
    </main>
  );
}
