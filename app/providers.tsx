"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "./SessionContext";

export function Providers({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
