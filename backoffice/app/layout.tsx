import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulso · Backoffice",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es">
    <body>
      <header className="topbar">
        <Link href="/" className="brand">Pulso <span>backoffice</span></Link>
        <nav aria-label="Principal"><Link href="/">Resumen</Link><Link href="/calls">Llamadas</Link></nav>
      </header>
      <main>{children}</main>
    </body>
  </html>;
}
