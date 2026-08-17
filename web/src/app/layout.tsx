import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/common/Sidebar';
import { EmergencySosBanner } from '@/components/dashboard/EmergencySosBanner';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'RoadScore Telematics',
  description: 'Real-time telemetry, trip segmentation, road quality mapping, and driver safety analytics.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} dark`}>
      <body className="bg-black text-white antialiased min-h-screen flex font-sans">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 min-h-screen bg-black">
          <EmergencySosBanner />
          {children}
        </main>
      </body>
    </html>
  );
}
