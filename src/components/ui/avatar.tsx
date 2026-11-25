import { avatarColor, cn, initials } from "@/lib/utils";

export function Avatar({
  id,
  name,
  src,
  size = 28,
  className,
  ring,
}: {
  id: string;
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  return (
    <span
      title={name}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38) }}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold tracking-tight text-white shadow-[0_0_0_1px_#ffffff26_inset]",
        avatarColor(id),
        ring && "ring-2 ring-white",
        className
      )}
    >
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}
