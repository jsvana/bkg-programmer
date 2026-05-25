"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Session } from "../src/protocol/session";
import { WebSerialTransport } from "../src/protocol/transport";
import { detect, type DetectionResult } from "../src/detection/detect";

export type ConnState =
  | { kind: "idle" }
  | { kind: "unsupported" }
  | { kind: "connecting" }
  | { kind: "connected"; result: DetectionResult; session: Session; transport: WebSerialTransport }
  | { kind: "error"; message: string };

interface SessionContextValue {
  state: ConnState;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnState>({ kind: "idle" });
  // Tracks the most recent live session for cleanup on unmount.
  const liveSessionRef = useRef<Session | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serial" in navigator)) {
      setState({ kind: "unsupported" });
    }
  }, []);

  const disconnect = useCallback(async () => {
    const s = liveSessionRef.current;
    liveSessionRef.current = null;
    if (s) {
      try {
        await s.close();
      } catch {
        // ignore
      }
    }
    setState({ kind: "idle" });
  }, []);

  const connect = useCallback(async () => {
    setState({ kind: "connecting" });
    let session: Session | null = null;
    let transport: WebSerialTransport | null = null;
    try {
      const port = await navigator.serial.requestPort();
      transport = new WebSerialTransport(port, { baudRate: 38400 });
      session = await Session.open(transport);
      const result = await detect(session);
      liveSessionRef.current = session;
      setState({ kind: "connected", result, session, transport });
    } catch (err) {
      if (session) {
        try {
          await session.close();
        } catch {
          // ignore
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      if (/No port selected/i.test(message)) {
        setState({ kind: "idle" });
        return;
      }
      setState({ kind: "error", message });
    }
  }, []);

  useEffect(() => {
    return () => {
      const s = liveSessionRef.current;
      if (s) s.close().catch(() => {});
    };
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ state, connect, disconnect }),
    [state, connect, disconnect],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return ctx;
}
