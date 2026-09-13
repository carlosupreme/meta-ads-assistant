import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulso AI — Meta Ads en piloto automático",
  description: "Monitorea y optimiza Facebook e Instagram Ads con agentes autónomos.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
