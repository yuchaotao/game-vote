import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

// Pages for signed-out visitors. Signed-in users go home.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/");
  return <main className="mx-auto w-full max-w-sm px-4 py-12">{children}</main>;
}
