import { AuthTokenType } from "@prisma/client";
import Link from "next/link";
import { Alert, Card } from "@/components/ui";
import { consumeToken } from "@/lib/auth/users";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("验证邮箱")} · Game Vote` };
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const t = await getT();
  const { token } = await searchParams;
  const userId = token ? await consumeToken(token, AuthTokenType.EMAIL_VERIFY) : null;
  if (userId) {
    await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  }

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-12">
      <Card className="space-y-4">
        <h1 className="text-2xl font-bold">{t("验证邮箱")}</h1>
        {userId ? (
          <Alert kind="ok">{t("邮箱验证成功！")}</Alert>
        ) : (
          <Alert kind="error">{t("链接无效或已过期。可以在设置页重新发送验证邮件。")}</Alert>
        )}
        <Link href="/" className="text-sm text-indigo-600 hover:underline">
          {t("返回首页")}
        </Link>
      </Card>
    </main>
  );
}
