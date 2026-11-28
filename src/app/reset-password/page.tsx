import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-page";
import { ResetPasswordForm } from "@/components/auth/password-reset";

export const metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
