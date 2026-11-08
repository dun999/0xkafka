import type { Metadata } from 'next';
import { IBM_Plex_Mono, Inter } from 'next/font/google';
import { currentUser } from '@/src/auth/current';
import { publicProfile } from '@/src/agents/views';
import { SessionProvider } from '@/components/wallet/session';
import './globals.css';

const sans = Inter({ subsets: ['latin'], variable: '--font-inter' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_URL ?? 'https://0xkafka.xyz'),
  title: { default: "0xkafka: predictions you can't take back", template: '%s · 0xkafka' },
  description:
    'Predict before the game for free. Saved on Walrus, scored when it ends, shared to X. 0xkafka learns from every prediction and sells its own signal over MPP.',
  openGraph: { siteName: '0xkafka' },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  const initial = { address: me?.session.address ?? null, profile: me?.profile ? publicProfile(me.profile) : null };
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Lets CSS hide hero text that decodes on load, only when scripts can run it. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        <SessionProvider initial={initial}>{children}</SessionProvider>
      </body>
    </html>
  );
}
