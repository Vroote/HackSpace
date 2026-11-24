"use client";

import { useEffect, useRef, useState } from "react";
import { observeUnlocks, type UnlockHistory } from "@/lib/pipeline";
import type { Board } from "@/lib/types";
import { Notice } from "./ui";

function readHistory(key: string): UnlockHistory | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (Array.isArray(value?.blocked) && Array.isArray(value?.unread)) return value;
  } catch { /* Storage can be unavailable in private browsing. */ }
  return null;
}

export function UnblockedNotifications({ board, login }: { board: Board; login: string }) {
  const key = JSON.stringify(["hackspace-unlocks", board.projectUrl, board.repoUrl, login]);
  const memory = useRef<UnlockHistory | null>(null);
  const [unread, setUnread] = useState<string[]>([]);

  function save(value: UnlockHistory) {
    memory.current = value;
    setUnread(value.unread);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep in-memory state. */ }
  }

  useEffect(() => {
    save(observeUnlocks(board, login, readHistory(key) ?? memory.current ?? { blocked: [], unread: [] }));
  }, [board, login, key]);

  return board.issues.filter(issue => unread.includes(issue.id)).map(issue => (
    <Notice key={issue.id} tone="blue" role="status">
      Ваша задача разблокирована · <a href={issue.url} target="_blank" rel="noreferrer">#{issue.number} {issue.title}</a>{" "}
      <button className="button" onClick={() => {
        const history = readHistory(key) ?? memory.current!;
        save({ ...history, unread: history.unread.filter(id => id !== issue.id) });
      }}>Прочитано</button>
    </Notice>
  ));
}
