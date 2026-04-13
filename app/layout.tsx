import type { Metadata } from 'next';
import { DM_Sans, IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';

const bodySans = DM_Sans({
  variable: '--font-body',
  subsets: ['latin'],
  display: 'swap',
});

const displaySans = Space_Grotesk({
  variable: '--font-display',
  subsets: ['latin'],
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  variable: '--font-code',
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'Splashboard — Visual Discovery',
  description:
    'Describe a vibe or upload a photo to find Unsplash images that match the mood, lighting, and aesthetic.',
  openGraph: {
    title: 'Splashboard',
    description: 'Find Unsplash images by vibe, not keywords.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bodySans.variable} ${displaySans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
