import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: { default: 'Forge', template: '%s | Forge' },
  description: 'Tickets, GitHub collaboration and deterministic workflow automation.',
};

export const viewport: Viewport = { themeColor: '#0f1216', colorScheme: 'dark' };

// Only the document itself lives here. The application shell belongs to the signed-in area
// (see (app)/layout.tsx), so the sign-in page and the error pages render without it.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
