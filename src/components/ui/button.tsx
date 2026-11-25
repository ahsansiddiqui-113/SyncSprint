import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50 cursor-pointer active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-primary text-white shadow-[0_2px_8px_-2px_rgba(123,104,238,0.55)] hover:bg-primary-dark",
        outline: "border border-border-strong bg-white text-foreground hover:bg-hover",
        ghost: "text-muted hover:bg-hover hover:text-foreground",
        destructive: "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100",
        subtle: "bg-surface-2 text-foreground hover:bg-hover",
        ai: "border border-primary/30 bg-primary-soft text-primary hover:bg-primary/15 hover:border-primary/50",
      },
      size: {
        sm: "h-9 px-3.5 text-[15px]",
        md: "h-10 px-4 text-[15px]",
        lg: "h-12 px-6 text-[17px] rounded-xl",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  }
);

export function Button({
  className,
  variant,
  size,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
