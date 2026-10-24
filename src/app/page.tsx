export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-4xl font-bold tracking-tight">Game Vote</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        和朋友一起建群、聊天、维护游戏库，投票决定下一次玩什么。
      </p>
      <ul className="grid gap-2 text-zinc-700 sm:grid-cols-2 dark:text-zinc-300">
        <li>🎮 Steam / 本站账号登录</li>
        <li>👥 好友与群组</li>
        <li>📚 群游戏库与热度排行</li>
        <li>🗳️ 投票与历史回放</li>
      </ul>
      <p className="text-sm text-zinc-500">建设中</p>
    </main>
  );
}
