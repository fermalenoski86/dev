'use client';

import type { Me } from '../lib/api';
import { useSession } from './SessionGate';

export function AppHeaderView({ me, onLogout }: { me: Me; onLogout: () => void }) {
  return (
    <header className="header">
      <span className="brand">TRUST · Plataforma</span>
      <span className="who" aria-label="Sesión">
        {me.user.name} · {me.roles.join(', ')}
      </span>
      <button type="button" onClick={onLogout}>
        Salir
      </button>
    </header>
  );
}

export function AppHeader() {
  const { me, logout } = useSession();
  if (!me) return null;
  return <AppHeaderView me={me} onLogout={() => void logout()} />;
}
