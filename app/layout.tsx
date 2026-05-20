import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Balanço de Estoque — CJ Rasteirinhas',
  description: 'Simulador de promoção e balanço de estoque',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-slate-50 text-slate-950 min-h-screen">
        {children}
      </body>
    </html>
  )
}
