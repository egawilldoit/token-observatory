import { AuthShell } from "@/components/auth-shell";
import { UpdatePasswordForm } from "@/components/update-password-form";

export default function Page() {
  return (
    <AuthShell>
      <UpdatePasswordForm />
    </AuthShell>
  );
}
