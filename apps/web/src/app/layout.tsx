import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';

export const metadata: Metadata = {
  title: { default: 'Forge', template: '%s | Forge' },
  description: 'Tickets, GitHub collaboration and deterministic workflow automation.',
};

export const viewport: Viewport = { themeColor: '#0f1216', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
