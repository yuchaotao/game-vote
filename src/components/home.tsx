"use client";

import { usePathname } from "next/navigation";
import { useActionState, useEffect } from "react";
import { saveHomePage } from "@/lib/home/actions";
import { GROUP_TABS, LAST_PAGE_COOKIE, rememberable } from "@/lib/home/rules";
import { Alert, Button } from "./ui";

/** Remembers the current page on this device, so the home page can return to it. */
export function RememberPage() {
  const pathname = usePathname();
  useEffect(() => {
    if (!rememberable(pathname)) return;
    document.cookie = `${LAST_PAGE_COOKIE}=${encodeURIComponent(pathname)}; path=/; max-age=31536000; samesite=lax`;
  }, [pathname]);
  return null;
}

/** Settings: the last visited page, or a fixed group tab. */
export function HomePageForm({
  current,
  groups,
}: {
  current: string | null;
  groups: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(saveHomePage, undefined);
  return (
    <form action={action} className="space-y-3">
      {state?.error && <Alert kind="error">{state.error}</Alert>}
      {state?.ok && <Alert kind="ok">{state.ok}</Alert>}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">默认首页</span>
        <select
          name="homePath"
          defaultValue={current ?? ""}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        >
          <option value="">总是显示最近访问</option>
          {groups.map((g) => (
            <optgroup key={g.id} label={g.name}>
              {GROUP_TABS.map((t) => (
                <option key={t.path} value={`/groups/${g.id}${t.path}`}>
                  {g.name} · {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="text-xs text-zinc-500">
        「最近访问」按设备记住：在这台设备上打开网站时，回到你上次看的群页面或好友页。
      </p>
      <Button disabled={pending}>保存默认首页</Button>
    </form>
  );
}
