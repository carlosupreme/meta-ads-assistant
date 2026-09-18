import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Inter is the closest widely available face to Apple's SF; loading it here keeps the UI identical on every device.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Pulso AI — Meta Ads en piloto automático",
  description: "Monitorea y optimiza Facebook e Instagram Ads con agentes autónomos.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
