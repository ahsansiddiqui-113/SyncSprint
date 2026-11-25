import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "SyncSprint — plan, track and ship work together",
  description: "Boards, lists, calendars, timelines and dashboards for your team — always in sync, with an AI assistant built in.",
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
