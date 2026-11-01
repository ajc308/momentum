import type { Metadata, Viewport } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import './globals.css'
import { AppShell } from '@/components/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { SessionProvider } from 'next-auth/react'

const body = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' })
const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-display', weight: ['500', '600', '700'], display: 'swap' })

export const metadata: Metadata = {
  title: 'Momentum',
  description: 'Your training, at a glance',
  icons: {
    icon: '/momentum.svg',
    apple: '/momentum-512.png',
  },
  appleWebApp: { title: 'Momentum', statusBarStyle: 'black-translucent' },
}

export const viewport: Viewport = {
  themeColor: '#F5F6F1',
  colorScheme: 'light',
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body className="font-sans">
        <SessionProvider>
          <ErrorBoundary>
            <AppShell>{children}</AppShell>
          </ErrorBoundary>
        </SessionProvider>
      </body>
    </html>
  )
}
