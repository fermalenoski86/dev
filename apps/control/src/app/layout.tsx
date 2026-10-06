import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MASTER OF TRUST — Control Center',
  description: 'Centro de control de EL TRUST. Telemetría simulada, sin hardware conectado.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-neutral-950 antialiased">{children}</body>
    </html>
  );
}
