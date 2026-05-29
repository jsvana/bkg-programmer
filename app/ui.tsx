"use client";

/**
 * Shared presentational primitives for the workspace panels.
 *
 * The design goal these serve: lead with plain, task-shaped language and a
 * clear sense of which steps matter, while keeping the workshop-tool honesty
 * (hex addresses, protocol detail, firmware citations) one disclosure click
 * away rather than deleted. See CLAUDE.md "Design Context" — "Cite, don't
 * reassure" still holds; we just stop making the citation the headline.
 *
 * - <StepGroup> labels a run of panels as a numbered step and flags whether
 *   it's important (do this first) or optional.
 * - <TechDetails> is the canonical "Technical detail" expander. Anything that
 *   only means something to someone reading firmware source goes inside one.
 * - <Banner> is the shared status note.
 * - plainExecResult() turns a writer ExecResult into one human sentence.
 */

import type { ReactNode } from "react";
import type { ExecResult } from "../src/writer/plan";

export function StepGroup({
  n,
  title,
  importance,
  hint,
  children,
}: {
  n: number;
  title: string;
  importance?: "important" | "optional";
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="step-group">
      <div className="step-group-head">
        <span className="step-num">Step {n}</span>
        <span className="step-title">{title}</span>
        {importance ? (
          <span className={`step-tag ${importance}`}>
            {importance === "important" ? "do this first" : "optional"}
          </span>
        ) : null}
      </div>
      {hint ? <p className="step-hint">{hint}</p> : null}
      <div className="step-group-body">{children}</div>
    </section>
  );
}

export function TechDetails({
  summary = "Technical detail",
  open = false,
  children,
}: {
  summary?: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="tech" open={open}>
      <summary>{summary}</summary>
      <div className="tech-body">{children}</div>
    </details>
  );
}

export function Banner({
  kind,
  children,
}: {
  kind: "info" | "note" | "warn" | "error" | "success";
  children: ReactNode;
}) {
  return <div className={`banner ${kind}`}>{children}</div>;
}

/**
 * One plain sentence describing how a write turned out. Keeps the failure
 * causes truthful (we don't hide that a verify mismatch happened) but says it
 * in words rather than enum tags. The raw status/reason is still available to
 * anyone who wants it via a TechDetails block at the call site.
 */
export function plainExecResult(exec: ExecResult): string {
  switch (exec.status) {
    case "success":
      return "Saved and confirmed on the radio.";
    case "success-with-warnings":
      return `Saved, with notes: ${exec.warnings.map((w) => w.message).join("; ")}`;
    case "aborted-preflight":
      return `Couldn't start — a safety check failed: ${exec.failedChecks
        .map((c) => c.message)
        .join("; ")}`;
    case "aborted-mid-execute": {
      const r = exec.reason;
      const reason =
        r.kind === "verify-mismatch"
          ? "the radio didn't save a change correctly (what we read back didn't match what we wrote)"
          : r.kind === "snapshot-drift"
            ? "the radio's data changed underneath us partway through"
            : r.kind === "protocol-error"
              ? `the radio reported a communication error (${r.underlying.message})`
              : r.kind === "timeout"
                ? `the radio stopped responding (timed out after ${Math.round(
                    r.afterMs / 1000,
                  )}s)`
                : r.kind;
      return `Stopped partway to keep your radio safe — ${reason}. Nothing after that point was changed.`;
    }
  }
}
