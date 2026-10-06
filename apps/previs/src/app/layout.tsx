import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TRUST PREVIS',
  description: 'Digital twin de EL TRUST — Buenos Aires',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-neutral-950 antialiased">{children}</body>
    </html>
  );
}
