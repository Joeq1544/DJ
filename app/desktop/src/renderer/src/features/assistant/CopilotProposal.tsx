import type { AssistantProposal } from "../../../../shared/contracts";

interface CopilotProposalProps {
  proposal: AssistantProposal;
  active: boolean;
  confirming: boolean;
  onConfirm(): void;
  onDiscard(): void;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled proposal mutation: ${String(value)}`);
}

function candidateFilterSummary(filters: Extract<AssistantProposal, { kind: "plan" }>["plan"]["candidateFilters"]): string {
  const entries = Object.entries(filters).filter((entry): entry is [string, Exclude<(typeof entry)[1], undefined>] => entry[1] !== undefined);
  if (entries.length === 0) return "Any local track";
  return entries.map(([key, value]) => {
    if ((key === "bpmMinMilli" || key === "bpmMaxMilli") && typeof value === "number") return `${key}: ${value / 1_000} BPM`;
    if ((key === "energyMinPpm" || key === "energyMaxPpm") && typeof value === "number") return `${key}: ${value.toLocaleString("en-US")} ppm`;
    return `${key}: ${String(value).replaceAll("_", " ")}`;
  }).join(" · ");
}

function planDetails(proposal: Extract<AssistantProposal, { kind: "plan" }>) {
  return (
    <dl className="copilot-proposal__ledger">
      <div><dt>Intent</dt><dd>{proposal.plan.intent.replaceAll("_", " ")}</dd></div>
      <div><dt>Target duration</dt><dd>{proposal.plan.targetDurationMs === null ? "No target" : `${proposal.plan.targetDurationMs / 60_000} minutes`}</dd></div>
      <div><dt>Artist repeat cap</dt><dd>{proposal.plan.maxArtistRepeats ?? "No cap"}</dd></div>
      <div><dt>Maximum tracks</dt><dd>{proposal.source.maxTracks}</dd></div>
      <div><dt>Seed track</dt><dd>{proposal.source.seedTrackId ?? "No fixed seed"}</dd></div>
      <div><dt>Candidate filters</dt><dd>{candidateFilterSummary(proposal.plan.candidateFilters)}</dd></div>
    </dl>
  );
}

function mutationDescription(proposal: Extract<AssistantProposal, { kind: "revision" }>): string {
  const mutation = proposal.mutation;
  switch (mutation.type) {
    case "rename": return `Rename draft to “${mutation.title}”`;
    case "set_plan": return `Replace the draft plan with a ${mutation.plan.intent.replaceAll("_", " ")} plan`;
    case "move_entry": return `Move entry ${mutation.entryId} to position ${mutation.toIndex + 1}`;
    case "set_track_pin": return `${mutation.pinned ? "Pin" : "Unpin"} track entry ${mutation.entryId}`;
    case "set_position_pin": return `${mutation.pinned ? "Pin" : "Unpin"} the position of entry ${mutation.entryId}`;
    case "remove_entry": return `Remove entry ${mutation.entryId}`;
    case "ban_entry": return `Remove and ban entry ${mutation.entryId}`;
    case "replace_entry": return `Replace entry ${mutation.entryId} with local track ${mutation.replacementTrackId}`;
    case "set_entry_goal": return `Update the role or energy goal for entry ${mutation.entryId}`;
    case "optimize": return "Optimize the current draft order";
    default: return assertNever(mutation);
  }
}

export function CopilotProposal({ proposal, active, confirming, onConfirm, onDiscard }: CopilotProposalProps) {
  return (
    <section className="copilot-proposal" aria-label="Copilot proposal">
      <p className="copilot-proposal__eyebrow">Proposal — not applied</p>
      <h3>{proposal.kind === "plan" ? proposal.title : "One draft revision"}</h3>
      <p>{proposal.summary}</p>
      {proposal.kind === "plan" ? planDetails(proposal) : (
        <>
          <p className="copilot-proposal__mutation">{mutationDescription(proposal)}</p>
          {proposal.evidenceTrackIds.length === 0 ? null : (
            <p className="copilot-proposal__evidence">Local evidence: {proposal.evidenceTrackIds.join(", ")}</p>
          )}
        </>
      )}
      <p className="copilot-proposal__warning">Nothing changes until you confirm.</p>
      <div className="copilot-actions">
        <button type="button" className="copilot-button copilot-button--primary" disabled={active || confirming} onClick={onConfirm}>
          {confirming ? "Confirming…" : "Confirm proposal"}
        </button>
        <button type="button" className="copilot-button" disabled={active || confirming} onClick={onDiscard}>Discard proposal</button>
      </div>
    </section>
  );
}
