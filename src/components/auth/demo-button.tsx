"use client";

import { useTransition } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { launchDemoAction } from "@/actions/demo.actions";

export function DemoButton({ size = "lg", variant = "default" }: { size?: "md" | "lg"; variant?: "default" | "inverse" }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size={size}
      disabled={pending}
      onClick={() => start(() => launchDemoAction())}
      className={cn(variant === "inverse" && "bg-white text-primary shadow-lg hover:bg-white/90")}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
      {pending ? "Seeding your private workspace…" : "Launch interactive demo"}
    </Button>
  );
}
