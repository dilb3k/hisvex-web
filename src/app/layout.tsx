import type { Metadata } from 'next'
import { HydrateProvider } from '@/components/HydrateProvider'
import '../styles/globals.css'

export const metadata: Metadata = {
  title: 'Hisvex — Hisob-kitob paneli',
  description: 'Hisvex — bar, kafe va do\'konlar uchun hisob-kitob paneli.',
  openGraph: {
    title: 'Hisvex — Hisob-kitob paneli',
    description: 'Bar va do\'konlar uchun hisob-kitob paneli.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" type="image/png" href="/logo.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;0,9..144,900;1,9..144,500&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <HydrateProvider>{children}</HydrateProvider>
      </body>
    </html>
  )
}
