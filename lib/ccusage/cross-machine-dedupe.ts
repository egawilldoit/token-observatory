import type {
  CurrentDailyUsageRow,
  DailyUsageObservationInput,
  SessionUsageObservationInput,
  StoredSessionEvidenceRow,
} from "./types";

export const MIN_STRONG_SESSION_MATCHES = 2;
export const MIN_STRONG_SESSION_OVERLAP = 0.8;

export type SessionMirrorEvidence = {
  machineId: string;
  agent: string;
  incomingSessions: number;
  existingSessions: number;
  exactSessionMatches: number;
  identityMatches: number;
  exactOverlapRatio: number;
  evidenceStart: string | null;
  evidenceEnd: string | null;
  strong: boolean;
};

export type CrossMachineDailyLink = {
  agent: string;
  usage_date: string;
  canonical_observation_id: string;
  canonical_machine_id: string;
  reason: "exact_raw_snapshot" | "exact_daily_with_session_evidence";
  matched_session_count: number;
  session_overlap_ratio: number;
  evidence: Record<string, unknown>;
};

export type CrossMachineAnalysis = {
  evidence: SessionMirrorEvidence[];
  links: CrossMachineDailyLink[];
  duplicateTokensPrevented: number;
  partialMirrorRisk: boolean;
  exactSessionMatches: number;
  identityMatches: number;
};

function dateOnly(value: string | null) {
  return value?.slice(0, 10) ?? null;
}

function exactDailyUsageMatch(
  incoming: DailyUsageObservationInput,
  existing: CurrentDailyUsageRow,
) {
  return (
    incoming.agent === existing.agent &&
    incoming.usage_date === existing.usage_date &&
    incoming.input_tokens === existing.input_tokens &&
    incoming.output_tokens === existing.output_tokens &&
    incoming.cache_read_tokens === existing.cache_read_tokens &&
    incoming.cache_creation_tokens === existing.cache_creation_tokens &&
    incoming.reported_total_tokens === existing.reported_total_tokens
  );
}

function uniqueCount<T>(rows: T[], selector: (row: T) => string) {
  return new Set(rows.map(selector)).size;
}

function intersectionSize(left: Set<string>, right: Set<string>) {
  let count = 0;
  for (const item of left) {
    if (right.has(item)) count += 1;
  }
  return count;
}

function evidenceForPair(
  incoming: SessionUsageObservationInput[],
  existing: StoredSessionEvidenceRow[],
  machineId: string,
  agent: string,
): SessionMirrorEvidence {
  const incomingRows = incoming.filter((row) => row.agent === agent);
  const existingRows = existing.filter(
    (row) => row.machine_id === machineId && row.agent === agent,
  );

  const incomingMirror = new Set(incomingRows.map((row) => row.mirror_hash));
  const existingMirror = new Set(existingRows.map((row) => row.mirror_hash));
  const incomingIdentity = new Set(incomingRows.map((row) => row.identity_hash));
  const existingIdentity = new Set(existingRows.map((row) => row.identity_hash));

  const exactSessionMatches = intersectionSize(
    incomingMirror,
    existingMirror,
  );
  const identityMatches = intersectionSize(
    incomingIdentity,
    existingIdentity,
  );
  const denominator = Math.min(
    incomingIdentity.size,
    existingIdentity.size,
  );
  const exactOverlapRatio =
    denominator > 0
      ? Math.min(1, exactSessionMatches / denominator)
      : 0;

  const matchedRows = incomingRows.filter((row) =>
    existingMirror.has(row.mirror_hash),
  );
  const startDates = matchedRows
    .map((row) => dateOnly(row.first_activity ?? row.last_activity))
    .filter((value): value is string => Boolean(value))
    .sort();
  const endDates = matchedRows
    .map((row) => dateOnly(row.last_activity ?? row.first_activity))
    .filter((value): value is string => Boolean(value))
    .sort();

  const evidenceStart = startDates[0] ?? null;
  const evidenceEnd = endDates.at(-1) ?? null;
  const strong =
    exactSessionMatches >= MIN_STRONG_SESSION_MATCHES &&
    exactOverlapRatio >= MIN_STRONG_SESSION_OVERLAP &&
    evidenceStart !== null &&
    evidenceEnd !== null;

  return {
    machineId,
    agent,
    incomingSessions: uniqueCount(incomingRows, (row) => row.identity_hash),
    existingSessions: uniqueCount(existingRows, (row) => row.identity_hash),
    exactSessionMatches,
    identityMatches,
    exactOverlapRatio,
    evidenceStart,
    evidenceEnd,
    strong,
  };
}

export function analyzeCrossMachineDuplicates({
  incomingDaily,
  incomingSessions,
  existingDaily,
  existingSessions,
  rawDuplicateMachineId,
}: {
  incomingDaily: DailyUsageObservationInput[];
  incomingSessions: SessionUsageObservationInput[];
  existingDaily: CurrentDailyUsageRow[];
  existingSessions: StoredSessionEvidenceRow[];
  rawDuplicateMachineId?: string | null;
}): CrossMachineAnalysis {
  const machines = [
    ...new Set([
      ...existingDaily.map((row) => row.machine_id),
      ...existingSessions.map((row) => row.machine_id),
    ]),
  ];
  const agents = [...new Set(incomingDaily.map((row) => row.agent))];
  const evidence = machines.flatMap((machineId) =>
    agents.map((agent) =>
      evidenceForPair(
        incomingSessions,
        existingSessions,
        machineId,
        agent,
      ),
    ),
  );

  const links: CrossMachineDailyLink[] = [];
  let partialMirrorRisk = false;

  for (const incoming of incomingDaily) {
    if (incoming.is_tombstone) continue;

    const exactCandidates = existingDaily.filter((existing) =>
      exactDailyUsageMatch(incoming, existing),
    );
    if (exactCandidates.length === 0) continue;

    let chosen: CurrentDailyUsageRow | undefined;
    let chosenEvidence: SessionMirrorEvidence | undefined;
    let reason: CrossMachineDailyLink["reason"] | undefined;

    if (rawDuplicateMachineId) {
      chosen = exactCandidates.find(
        (candidate) => candidate.machine_id === rawDuplicateMachineId,
      );
      if (chosen) reason = "exact_raw_snapshot";
    }

    if (!chosen) {
      const strongCandidates = evidence
        .filter(
          (item) =>
            item.agent === incoming.agent &&
            item.strong &&
            item.evidenceStart !== null &&
            item.evidenceEnd !== null &&
            incoming.usage_date >= item.evidenceStart &&
            incoming.usage_date <= item.evidenceEnd,
        )
        .sort(
          (a, b) =>
            b.exactSessionMatches - a.exactSessionMatches ||
            b.exactOverlapRatio - a.exactOverlapRatio,
        );

      for (const item of strongCandidates) {
        const candidate = exactCandidates.find(
          (row) => row.machine_id === item.machineId,
        );
        if (candidate) {
          chosen = candidate;
          chosenEvidence = item;
          reason = "exact_daily_with_session_evidence";
          break;
        }
      }
    }

    if (!chosen || !reason) {
      const candidateMachines = new Set(
        exactCandidates.map((candidate) => candidate.machine_id),
      );
      if (
        evidence.some(
          (item) =>
            item.agent === incoming.agent &&
            candidateMachines.has(item.machineId) &&
            (item.exactSessionMatches > 0 || item.identityMatches > 0),
        )
      ) {
        partialMirrorRisk = true;
      }
      continue;
    }

    links.push({
      agent: incoming.agent,
      usage_date: incoming.usage_date,
      canonical_observation_id: chosen.id,
      canonical_machine_id: chosen.machine_id,
      reason,
      matched_session_count:
        chosenEvidence?.exactSessionMatches ?? 0,
      session_overlap_ratio:
        chosenEvidence?.exactOverlapRatio ?? 1,
      evidence: {
        evidenceStart: chosenEvidence?.evidenceStart ?? null,
        evidenceEnd: chosenEvidence?.evidenceEnd ?? null,
        rawSnapshotMatch: reason === "exact_raw_snapshot",
      },
    });
  }

  return {
    evidence,
    links,
    duplicateTokensPrevented: links.reduce((total, link) => {
      const row = incomingDaily.find(
        (item) =>
          item.agent === link.agent &&
          item.usage_date === link.usage_date,
      );
      return total + (row?.reported_total_tokens ?? 0);
    }, 0),
    partialMirrorRisk,
    exactSessionMatches: evidence.reduce(
      (total, item) => total + item.exactSessionMatches,
      0,
    ),
    identityMatches: evidence.reduce(
      (total, item) => total + item.identityMatches,
      0,
    ),
  };
}
