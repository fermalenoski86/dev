'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { HOME_PATH } from '../lib/session';

export default function Inicio() {
  const router = useRouter();
  useEffect(() => router.replace(HOME_PATH), [router]);
  return (
    <main className="page" id="contenido">
      <p role="status">Redirigiendo…</p>
    </main>
  );
}
