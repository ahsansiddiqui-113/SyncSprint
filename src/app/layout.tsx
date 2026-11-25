import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "SyncSprint — real-time multi-tenant sprint board",
  description: "Multi-tenant Kanban with RBAC, real-time sync, optimistic concurrency and free-tier AI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        {children}
        <Toaster
          theme="light"
          richColors
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: "!rounded-xl !shadow-lift !text-[15px]",
              description: "!text-muted",
            },
          }}
        />
      </body>
    </html>
  );
}
