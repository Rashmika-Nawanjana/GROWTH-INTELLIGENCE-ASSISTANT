import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Calistoga } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

const calistoga = Calistoga({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-serif',
});

export const metadata: Metadata = {
  title: 'Veracity AI',
  description: 'Growth Intelligence',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${calistoga.variable}`}>
      <body className="font-sans antialiased text-foreground bg-background" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
