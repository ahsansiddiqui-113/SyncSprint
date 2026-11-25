import { cn } from "@/lib/utils";

const base =
  "w-full rounded-lg border border-border-strong bg-white px-3.5 py-2 text-[15px] text-foreground placeholder:text-subtle transition-colors hover:border-[#bcc2cb] focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15 disabled:bg-surface-2 disabled:opacity-70";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "min-h-24 leading-relaxed", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, "h-11 cursor-pointer py-1", className)} {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[14px] font-medium text-muted", className)} {...props} />;
}
