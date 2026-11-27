import { notFound } from "next/navigation";
import { db } from "@/db";
import { getPublicForm } from "@/server/services/forms";
import { Logo } from "@/components/ui/card";
import { PublicForm } from "@/components/forms/public-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const f = await getPublicForm(db, token);
  return { title: f ? f.name : "Form", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
}

export default async function FormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await getPublicForm(db, token);
  if (!form) notFound();
  return (
    <main className="min-h-screen bg-canvas px-4 py-10">
      <div className="mx-auto max-w-xl">
        <PublicForm token={token} form={form} />
        <p className="mt-8 flex items-center justify-center gap-2 text-[13px] text-subtle">
          Powered by <Logo className="text-[13px] [&_svg]:h-5 [&_svg]:w-5" />
        </p>
      </div>
    </main>
  );
}
