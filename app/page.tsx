"use client";

import { useState } from "react";
import { StatusRail } from "./StatusRail";
import { Hub } from "./Hub";
import { ToolWorkspace } from "./ToolWorkspace";
import type { ToolId, UtilityId } from "./types";

export default function Home() {
  const [view, setView] = useState<ToolId | UtilityId | null>(null);

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
          <Hub onSelect={setView} onOpenUtility={setView} />
        ) : (
          <ToolWorkspace tool={view} onBack={() => setView(null)} />
        )}
      </main>
    </div>
  );
}
