import type { Metadata } from 'next';
import { SessionGate } from '../components/SessionGate';
import './globals.css';

export const metadata: Metadata = {
  title: 'TRUST — Plataforma',
  description: 'Login, campañas y aprobación de versiones de TRUST.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <a className="skip" href="#contenido">
          Saltar al contenido
        </a>
        <SessionGate>{children}</SessionGate>
      </body>
    </html>
  );
}
