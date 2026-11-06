"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { withBase } from "@/lib/base-path";
import { loadOlderAction, markReadAction, sendMessageAction } from "@/lib/chat/actions";
import {
  MAX_MESSAGE_LENGTH,
  mergeMessages,
  segmentMessage,
  type ChatMessageDTO,
} from "@/lib/chat/format";
import { Avatar, Button } from "./ui";
import { useLocale, useT } from "./i18n";
import { intlLocale, type Locale } from "@/lib/i18n";

const EMOJIS = "😀😂🤣😊😍😎🤔😅😭😡👍👎👏🙏💪🎉🔥💯❤️🎮🕹️🏆⏰✅❌".match(
  /\p{Extended_Pictographic}️?/gu,
)!;

const format = (locale: Locale) => ({
  time: new Intl.DateTimeFormat(intlLocale(locale), { hour: "2-digit", minute: "2-digit" }),
  day: new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }),
});
const FORMAT = { zh: format("zh"), en: format("en") };

type Status = "connecting" | "live" | "reconnecting";

export function ChatPanel({
  groupId,
  meId,
  meName,
  memberNames,
  initial,
  initialHasMore,
}: {
  groupId: string;
  meId: string;
  meName: string;
  memberNames: string[];
  initial: ChatMessageDTO[];
  initialHasMore: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [messages, setMessages] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [status, setStatus] = useState<Status>("connecting");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [showEmoji, setShowEmoji] = useState(false);
  const [unseenBelow, setUnseenBelow] = useState(0);
  // Times use the viewer's timezone, so render them only on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const prependAnchor = useRef<number | null>(null);

  const nearBottom = () => {
    const el = scroller.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const scrollToBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    setUnseenBelow(0);
  };

  // Keep the view pinned to the bottom, or steady when older messages are prepended.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prependAnchor.current !== null) {
      el.scrollTop = el.scrollHeight - prependAnchor.current;
      prependAnchor.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    // Also once times appear (client only): they can make system messages taller.
  }, [messages, mounted]);

  const markRead = useCallback(() => {
    if (document.visibilityState === "visible") void markReadAction(groupId);
  }, [groupId]);

  // Live updates over Server-Sent Events; the browser reconnects automatically.
  useEffect(() => {
    const source = new EventSource(withBase(`/api/groups/${groupId}/events`));
    source.onopen = () => setStatus("live");
    source.onerror = () => setStatus("reconnecting");
    source.addEventListener("message", (e) => {
      const message = JSON.parse((e as MessageEvent).data) as ChatMessageDTO;
      stickToBottom.current = nearBottom();
      if (!stickToBottom.current && message.author?.id !== meId) setUnseenBelow((n) => n + 1);
      setMessages((prev) => mergeMessages(prev, [message]));
      markRead();
    });
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => {
      source.close();
      document.removeEventListener("visibilitychange", markRead);
    };
  }, [groupId, meId, markRead]);

  async function loadOlder() {
    if (!messages[0] || loadingOlder) return;
    setLoadingOlder(true);
    const res = await loadOlderAction(groupId, messages[0].id);
    const el = scroller.current;
    prependAnchor.current = el ? el.scrollHeight - el.scrollTop : null;
    stickToBottom.current = false;
    setMessages((prev) => mergeMessages(res.messages, prev));
    setHasMore(res.hasMore);
    setLoadingOlder(false);
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(undefined);
    const res = await sendMessageAction(groupId, text);
    setSending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setDraft("");
    stickToBottom.current = true;
    setMessages((prev) => mergeMessages(prev, [res.message]));
    input.current?.focus();
  }

  function insertEmoji(emoji: string) {
    const el = input.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  return (
    <section
      aria-label={t("群聊天")}
      className="flex h-[calc(100dvh-16rem)] min-h-[420px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800">
        <span>{t("聊天记录永久保存")}</span>
        <span aria-live="polite" className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${status === "live" ? "bg-emerald-500" : "bg-amber-400"}`}
          />
          {status === "live"
            ? t("实时")
            : status === "connecting"
              ? t("连接中…")
              : t("重新连接中…")}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          role="log"
          aria-label={t("消息")}
          onScroll={() => nearBottom() && setUnseenBelow(0)}
          className="h-full space-y-1 overflow-y-auto px-4 py-3"
        >
          {hasMore ? (
            <div className="flex justify-center pb-2">
              <Button
                type="button"
                variant="ghost"
                className="px-3 py-1 text-xs"
                disabled={loadingOlder}
                onClick={loadOlder}
              >
                {loadingOlder ? t("加载中…") : t("加载更早的消息")}
              </Button>
            </div>
          ) : (
            messages.length > 0 && (
              <p className="pb-2 text-center text-xs text-zinc-400">
                {t("— 已经到最早的消息了 —")}
              </p>
            )
          )}
          {messages.length === 0 && (
            <p className="py-12 text-center text-sm text-zinc-500">
              {t("还没有消息，打个招呼吧 👋")}
            </p>
          )}
          {messages.map((m, i) => (
            <Fragment key={m.id}>
              {(i === 0 || !sameDay(messages[i - 1].createdAt, m.createdAt)) && (
                <p className="py-2 text-center text-xs text-zinc-400">
                  {mounted ? FORMAT[locale].day.format(new Date(m.createdAt)) : " "}
                </p>
              )}
              <MessageRow
                message={m}
                previous={messages[i - 1]}
                meId={meId}
                meName={meName}
                memberNames={memberNames}
                mounted={mounted}
              />
            </Fragment>
          ))}
        </div>
        {unseenBelow > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-1 text-xs text-white shadow"
          >
            {t("{n} 条新消息 ↓", { n: unseenBelow })}
          </button>
        )}
      </div>

      <form
        className="border-t border-zinc-200 p-3 dark:border-zinc-800"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
        {showEmoji && (
          <div className="mb-2 flex flex-wrap gap-1" aria-label={t("表情")}>
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                className="rounded p-1 text-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => insertEmoji(e)}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            aria-label={t("表情")}
            aria-pressed={showEmoji}
            onClick={() => setShowEmoji((v) => !v)}
            className="rounded-lg p-2 text-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            😊
          </button>
          <textarea
            ref={input}
            aria-label={t("输入消息")}
            value={draft}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={1}
            placeholder={t("说点什么…（Enter 发送，Shift+Enter 换行）")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base outline-none sm:text-sm field-sizing-content focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <Button disabled={sending || !draft.trim()}>{t("发送")}</Button>
        </div>
        {draft.length > MAX_MESSAGE_LENGTH - 200 && (
          <p className="mt-1 text-right text-xs text-zinc-500">
            {draft.length}/{MAX_MESSAGE_LENGTH}
          </p>
        )}
      </form>
    </section>
  );
}

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function MessageRow({
  message: m,
  previous,
  meId,
  meName,
  memberNames,
  mounted,
}: {
  message: ChatMessageDTO;
  previous?: ChatMessageDTO;
  meId: string;
  meName: string;
  memberNames: string[];
  mounted: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const time = mounted ? FORMAT[locale].time.format(new Date(m.createdAt)) : "";

  if (m.type === "SYSTEM") {
    return (
      // Flex makes the text one block: as an inline box, its background and padding
      // would run over the neighbouring lines when it wraps.
      <p
        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 py-1 text-center text-xs text-zinc-500"
        data-system
      >
        <span
          className="min-w-0 rounded-2xl bg-zinc-100 px-3 py-1 break-words dark:bg-zinc-800"
          data-system-text
        >
          {m.body}
        </span>
        <span className="text-zinc-400">{time}</span>
      </p>
    );
  }

  const mine = m.author?.id === meId;
  const name = m.author?.displayName ?? t("已注销用户");
  // Consecutive messages from one author within 5 minutes are grouped.
  const grouped =
    previous?.type === "USER" &&
    previous.author?.id === m.author?.id &&
    sameDay(previous.createdAt, m.createdAt) &&
    new Date(m.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;

  return (
    <article
      aria-label={`${name} ${time}`}
      className={`flex gap-2 ${mine ? "flex-row-reverse" : ""} ${grouped ? "" : "pt-2"}`}
    >
      <div className="w-8 shrink-0">
        {!grouped && <Avatar src={m.author?.avatarUrl} name={name} size={32} />}
      </div>
      <div className={`flex max-w-[75%] flex-col ${mine ? "items-end" : "items-start"}`}>
        {!grouped && (
          <p className="mb-0.5 text-xs text-zinc-500">
            {mine ? t("我") : name} · {time}
          </p>
        )}
        <div
          title={time}
          className={`rounded-2xl px-3 py-1.5 text-sm break-words whitespace-pre-wrap ${
            mine
              ? "bg-indigo-600 text-white"
              : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          }`}
        >
          {segmentMessage(m.body, memberNames).map((s, i) =>
            s.type === "link" ? (
              <a
                key={i}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline underline-offset-2 break-all"
              >
                {s.href}
              </a>
            ) : s.type === "mention" ? (
              <span
                key={i}
                className={`font-semibold ${s.name === meName ? "rounded bg-amber-300/60 px-0.5" : ""}`}
              >
                @{s.name}
              </span>
            ) : (
              <Fragment key={i}>{s.text}</Fragment>
            ),
          )}
        </div>
      </div>
    </article>
  );
}
