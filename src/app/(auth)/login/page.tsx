import { LoginPanel } from "@/components/login-panel";
import { Card } from "@/components/ui";
import { AUTH_ERRORS, pick } from "@/lib/auth/messages";
import { safeNext } from "@/lib/friends/rules";

export const metadata = { title: "登录 · Game Vote" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <Card>
      <LoginPanel
        title="登录"
        error={pick(AUTH_ERRORS, params.error)}
        reset={Boolean(params.reset)}
        next={safeNext(params.next) ?? undefined}
      />
    </Card>
  );
}
