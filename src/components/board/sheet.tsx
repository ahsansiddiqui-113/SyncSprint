"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** shadcn-style slide-over / modal with Escape-to-close and backdrop blur. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  side = "right",
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: "right" | "center";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[rgba(29,33,41,0.32)] backdrop-blur-[1px]" onClick={onClose} />
      <div
        className={cn(
          "relative flex max-h-full flex-col overflow-hidden border-border-strong bg-card shadow-lift",
          side === "right"
            ? "ml-auto h-full w-full max-w-[720px] animate-slide-in border-l"
            : "m-auto max-h-[90vh] w-full max-w-2xl animate-fade-up rounded-2xl border"
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0 flex-1 font-semibold">{title}</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-md p-1.5 text-subtle transition-colors hover:bg-hover hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="border-t border-border bg-surface-2 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Section({ title, icon, action, children, className }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("mt-7", className)}>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h3 className="text-[14px] font-semibold uppercase tracking-wider text-subtle">{title}</h3>
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}
