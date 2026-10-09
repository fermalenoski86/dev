'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Me, PlatformClient } from '../lib/api';
import { browserClient } from '../lib/config';
import { redirectFor } from '../lib/session';
import { ErrorMessage, describeError } from './ui';

/**
 * Sesión del lado del navegador (ADR-063): la cookie es del host de la API,
 * así que los Server Components no la ven. Al montar, `GET /auth/me`; sin
 * sesión → `/login?next=…`. La autorización la decide la API en cada llamada.
 */
type Estado =
  | { kind: 'loading' }
  | { kind: 'ready'; me: Me | null }
  | { kind: 'error'; message: string };

interface SessionValue {
  client: PlatformClient;
  me: Me | null;
  setMe: (me: Me | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession fuera de SessionGate');
  return v;
}

export function SessionGate({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => browserClient(), []);
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [estado, setEstado] = useState<Estado>({ kind: 'loading' });

  useEffect(() => {
    if (!client) return;
    let vivo = true;
    client.me().then(
      (me) => vivo && setEstado({ kind: 'ready', me }),
      (e: unknown) => vivo && setEstado({ kind: 'error', message: describeError(e) }),
    );
    return () => {
      vivo = false;
    };
  }, [client]);

  const me = estado.kind === 'ready' ? estado.me : null;
  const destino = estado.kind === 'ready' ? redirectFor(pathname, me, typeof window === 'undefined' ? '' : window.location.search) : null;

  useEffect(() => {
    if (destino) router.replace(destino);
  }, [destino, router]);

  const setMe = useCallback((m: Me | null) => setEstado({ kind: 'ready', me: m }), []);
  const logout = useCallback(async () => {
    if (!client) return;
    await client.logout();
    setEstado({ kind: 'ready', me: null }); // la guarda manda a /login
  }, [client]);

  if (!client) {
    return (
      <main className="page">
        <ErrorMessage message="Falta configurar NEXT_PUBLIC_TRUST_API_URL (URL absoluta de platform-api)." />
      </main>
    );
  }
  if (estado.kind === 'error') {
    return (
      <main className="page">
        <ErrorMessage message={estado.message} />
      </main>
    );
  }
  if (estado.kind === 'loading' || destino) {
    return (
      <main className="page" aria-busy="true">
        <p role="status">Cargando sesión…</p>
      </main>
    );
  }
  return <Ctx.Provider value={{ client, me, setMe, logout }}>{children}</Ctx.Provider>;
}
