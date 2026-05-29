"use client";

import type { ReactNode } from "react";
import type { RadioModelId } from "../src/schema/types";
import type { RadioIdentity } from "../src/detection/detect";
import { useSession } from "./SessionContext";
import { radioCatalog, type RadioCatalogEntry } from "./radioCatalog";

/**
 * Renders candidate radio cards with photos and distinguishing
 * features. Appears when connected; emphasis shifts based on whether
 * detection is `confirmed`, `inferred`, `ambiguous`, or `conflict`.
 *
 * Models that share a marketing photo are merged into one card so the
 * picker doesn't show the same image twice with subtly different
 * bullet lists. Within a merged card, each variant gets its own
 * differentiator line.
 */
export function RadioIdentityHelp() {
  const { state } = useSession();
  if (state.kind !== "connected") return null;
  const { radio } = state.result;
  const candidates = candidateModelsFor(radio);
  if (candidates.length === 0) return null;

  const groups = groupByImage(candidates);

  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 20,
        marginTop: 20,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 18 }}>{headlineFor(radio)}</h2>
      <p style={{ color: "var(--muted)", marginTop: 8, fontSize: 14 }}>
        {introFor(radio)}
      </p>
      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: `repeat(auto-fit, minmax(260px, 1fr))`,
          gap: 16,
        }}
      >
        {groups.map((g, i) => (
          <RadioCard key={i} group={g} />
        ))}
      </div>
    </section>
  );
}

// ============ Card rendering ============

interface CardGroup {
  models: ReadonlyArray<{ id: RadioModelId; entry: RadioCatalogEntry }>;
  image: string | undefined;
}

function RadioCard({ group }: { group: CardGroup }) {
  const first = group.models[0]!;
  const isMulti = group.models.length > 1;
  const title = isMulti
    ? group.models.map((m) => m.entry.displayName).join(" or ")
    : first.entry.displayName;
  const idList = group.models.map((m) => m.id).join(" / ");

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          background: "#f7f7f7",
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {group.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={group.image}
            alt={title}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            no photo yet
          </span>
        )}
      </div>

      <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: -4 }}>
        <code>{idList}</code>
      </div>

      {first.entry.shared.length > 0 ? (
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          {first.entry.shared.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      ) : null}

      <div
        style={{
          fontWeight: 600,
          fontSize: 13,
          marginTop: 4,
          color: "var(--muted)",
        }}
      >
        {isMulti ? "How to tell them apart" : "Look for"}
      </div>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          fontSize: 13,
          lineHeight: 1.45,
        }}
      >
        {group.models.map((m) => (
          <li key={m.id}>
            {isMulti ? (
              <>
                <strong>{m.entry.displayName}:</strong>{" "}
                {m.entry.differentiator}
              </>
            ) : (
              m.entry.differentiator
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============ Grouping ============

/**
 * Group candidate models such that models sharing the same image
 * collapse into one card. Models with no image each stand alone.
 */
function groupByImage(
  candidates: ReadonlyArray<RadioModelId>,
): ReadonlyArray<CardGroup> {
  const groups: CardGroup[] = [];
  const byImage = new Map<string, CardGroup>();

  for (const id of candidates) {
    const entry = radioCatalog[id];
    const member = { id, entry };
    if (entry.image === undefined) {
      groups.push({ models: [member], image: undefined });
      continue;
    }
    const existing = byImage.get(entry.image);
    if (existing) {
      (existing.models as { id: RadioModelId; entry: RadioCatalogEntry }[]).push(
        member,
      );
    } else {
      const group: CardGroup = { models: [member], image: entry.image };
      byImage.set(entry.image, group);
      groups.push(group);
    }
  }

  return groups;
}

// ============ Detection-state copy ============

function candidateModelsFor(radio: RadioIdentity): ReadonlyArray<RadioModelId> {
  switch (radio.kind) {
    case "confirmed":
    case "inferred":
    case "ambiguous":
      return radio.models;
    case "conflict":
      return radio.firmwareCandidates;
    case "unknown":
      return [];
  }
}

function headlineFor(radio: RadioIdentity): string {
  switch (radio.kind) {
    case "confirmed":
      return "Your radio";
    case "inferred":
      return "Likely your radio — please verify";
    case "ambiguous":
      return "Which one is yours?";
    case "conflict":
      return "Detection conflict — which one is yours?";
    case "unknown":
      return "";
  }
}

function introFor(radio: RadioIdentity): ReactNode {
  switch (radio.kind) {
    case "confirmed":
      return "We're confident this is your radio. The card below is just for reference.";
    case "inferred":
      return "We narrowed it down to one model but couldn't fully confirm it. Compare your radio against the photo and notes below.";
    case "ambiguous":
      return "This firmware runs on more than one model, so we can't tell them apart automatically. Compare your radio against the photos below — the notes point out what to look for.";
    case "conflict":
      return "The signals we use to identify the radio disagree with each other, so changes are blocked for safety. Compare your radio against the options below and check which one you actually have.";
    case "unknown":
      return "";
  }
}
