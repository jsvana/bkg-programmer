"use client";

import { useCallback, useEffect, useState } from "react";
import { StatusRail } from "./StatusRail";
import { Hub } from "./Hub";
import { ToolWorkspace } from "./ToolWorkspace";
import type { ToolId, UtilityId } from "./types";

type View = ToolId | UtilityId | null;

const KNOWN_VIEWS: ReadonlySet<string> = new Set<View & string>([
  "flash",
  "program",
  "splash",
  "self-test",
  "identity",
  "connection-details",
]);

function viewFromHash(hash: string): View {
  const id = hash.replace(/^#/, "");
  return KNOWN_VIEWS.has(id) ? (id as Exclude<View, null>) : null;
}

function hashForView(view: View): string {
  return view === null ? "" : `#${view}`;
}

export default function Home() {
  const [view, setView] = useState<View>(null);

  // Sync from URL on mount and on browser back/forward.
  useEffect(() => {
    const apply = () => setView(viewFromHash(window.location.hash));
    apply();
    window.addEventListener("popstate", apply);
    window.addEventListener("hashchange", apply);
    return () => {
      window.removeEventListener("popstate", apply);
      window.removeEventListener("hashchange", apply);
    };
  }, []);

  const navigate = useCallback((next: View) => {
    setView((prev) => {
      if (prev === next) return prev;
      const targetHash = hashForView(next);
      const currentHash = window.location.hash;
      if (currentHash !== targetHash) {
        const url =
          targetHash === ""
            ? window.location.pathname + window.location.search
            : window.location.pathname + window.location.search + targetHash;
        window.history.pushState(null, "", url);
      }
      return next;
    });
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          <span className="wordmark-name">bkg-programmer</span>
          <span className="wordmark-tag">UV-K5 / UV-K1 · F4HWN</span>
        </div>
        <div className="topbar-meta">local · in-browser · web serial</div>
      </header>

      <StatusRail />

      <main className="workspace">
        {view === null ? (
          <Hub onSelect={navigate} onOpenUtility={navigate} />
        ) : (
          <ToolWorkspace tool={view} onBack={() => navigate(null)} />
        )}
      </main>
    </div>
  );
}
