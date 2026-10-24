import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth-forms";
import { Alert, Card } from "@/components/ui";

export const metadata = { title: "重置密码 · Game Vote" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <Card className="space-y-6">
      <h1 className="text-2xl font-bold">重置密码</h1>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Alert kind="error">
          链接不完整。请重新
          <Link href="/forgot-password" className="underline">
            申请重置
          </Link>
          。
        </Alert>
      )}
    </Card>
  );
}
