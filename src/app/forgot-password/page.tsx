import { AuthShell } from "@/components/auth/auth-page";
import { ForgotPasswordForm } from "@/components/auth/password-reset";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
