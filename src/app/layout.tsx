import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "moyaspov — Agenda Inteligente & Dashboard Creativo",
  description:
    "Plataforma minimalista de gestión de citas, sincronización inteligente con Notion y Google Calendar en tiempo real.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <body className="antialiased selection:bg-[#D96299]/30 selection:text-white">
        {children}
      </body>
    </html>
  );
}
