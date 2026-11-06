import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth-forms";
import { Alert, Card } from "@/components/ui";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("重置密码")} · Game Vote` };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const t = await getT();
  const { token } = await searchParams;
  return (
    <Card className="space-y-6">
      <h1 className="text-2xl font-bold">{t("重置密码")}</h1>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Alert kind="error">
          {t("链接不完整。请重新")}
          <Link href="/forgot-password" className="underline">
            {t("申请重置")}
          </Link>
          {t("。")}
        </Alert>
      )}
    </Card>
  );
}
