import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type {
  AssistantAuthStatus,
  AssistantEvent,
  AssistantProposal,
  AssistantSearchResult,
  AssistantTaskRequest,
  DesktopApi,
  DiscoveryIntent,
  SetDraftSnapshot,
  TrackListItem,
} from "../../../../shared/contracts";
import { CopilotProposal } from "./CopilotProposal";
import { CopilotResult, type CopilotCompletedResult } from "./CopilotResult";

export interface CopilotSelectedTrack {
  id: string;
  title: string;
  artist: string;
}

export interface CopilotPanelProps {
  api: DesktopApi["assistant"] | null;
  selectedTrack: CopilotSelectedTrack | null;
  draft: SetDraftSnapshot | null;
  knownTracks: ReadonlyArray<TrackListItem>;
  onOpenDraft(snapshot: SetDraftSnapshot): void;
}

type CopilotMode = "search" | "plan" | "revise" | "explain";
type ExplainSubject = "selected_track" | "next" | "draft";
type AssistantFailure = Extract<AssistantEvent, { type: "failed" }>["error"];

interface ActiveRequest {
  requestId: string;
  mode: CopilotMode;
  generation: number;
}

interface PendingProposal {
  requestId: string;
  proposal: AssistantProposal;
}

const MODES: ReadonlyArray<{ mode: CopilotMode; label: string }> = [
  { mode: "search", label: "Search" },
  { mode: "plan", label: "Plan set" },
  { mode: "revise", label: "Revise draft" },
  { mode: "explain", label: "Explain" },
];

const INTENTS: ReadonlyArray<{ value: DiscoveryIntent; label: string }> = [
  { value: "smooth", label: "Smooth" },
  { value: "build", label: "Build" },
  { value: "peak", label: "Peak" },
  { value: "reset", label: "Reset" },
  { value: "genre_shift", label: "Genre shift" },
  { value: "adventurous", label: "Adventurous" },
  { value: "singalong_continuation", label: "Singalong continuation" },
  { value: "closer", label: "Closer" },
];

const ACTIVITY_LABELS: Record<Extract<AssistantEvent, { type: "activity" }>["activity"], string> = {
  checking_auth: "Checking ChatGPT sign-in…",
  interpreting: "Interpreting your request…",
  searching_local: "Searching your local library…",
  preparing_proposal: "Preparing a proposal…",
  explaining: "Grounding the explanation…",
  validating: "Validating local evidence…",
};

const CHECKING_STATUS: AssistantAuthStatus = {
  state: "checking",
  auth: "unknown",
  message: "Checking ChatGPT sign-in.",
  sdkVersion: null,
};

const UNAVAILABLE_STATUS: AssistantAuthStatus = {
  state: "unavailable",
  auth: "unknown",
  message: "Copilot could not reach the local Codex installation.",
  sdkVersion: null,
};

const POLL_DELAY_MS = 100;

function statusTitle(status: AssistantAuthStatus | null): string {
  if (status === null) return "Copilot status not checked";
  switch (status.state) {
    case "checking": return "Checking ChatGPT sign-in…";
    case "ready": return "ChatGPT ready";
    case "signed_out": return "ChatGPT sign-in required";
    case "unsupported_auth": return "Unsupported Codex authentication";
    case "unavailable": return "Copilot unavailable";
  }
}

function failureMessage(code: AssistantFailure["code"]): string {
  switch (code) {
    case "signed_out": return "ChatGPT sign-in is required. Sign in, then try again.";
    case "unsupported_auth": return "Copilot requires ChatGPT authentication. Other Codex authentication is not supported.";
    case "timeout": return "Copilot timed out. Nothing was changed.";
    case "cancelled": return "Copilot request cancelled. Nothing was changed.";
    case "invalid_response": return "Copilot returned an invalid response. Nothing was changed.";
    case "invalid_context": return "The selected track or draft is no longer current. Nothing was changed.";
    case "conflict": return "The draft changed before Copilot finished. Nothing was changed.";
    case "unavailable": return "Copilot is unavailable. Your local library and drafts are unchanged.";
    case "unknown": return "Copilot could not complete the request. Nothing was changed.";
  }
}

function blockedConfirmationMessage(code: Extract<Awaited<ReturnType<DesktopApi["assistant"]["confirm"]>>, { status: "blocked" }>["code"]): string {
  switch (code) {
    case "not_found": return "This proposal is no longer available. Nothing was changed.";
    case "expired": return "This proposal expired. Nothing was changed.";
    case "mismatch": return "This proposal does not match the active request. Nothing was changed.";
    case "stale": return "This proposal is stale. Nothing was changed.";
    case "invalid": return "This proposal is no longer valid. Nothing was changed.";
    case "unavailable": return "Copilot could not confirm the proposal. Nothing was changed.";
  }
}

function modeDescription(mode: CopilotMode, selectedTrack: CopilotSelectedTrack | null, draft: SetDraftSnapshot | null): string {
  switch (mode) {
    case "search": return selectedTrack === null
      ? "Describe tracks, filters, or a local-library search."
      : `Search the local library with ${selectedTrack.title} available as context.`;
    case "plan": return selectedTrack === null
      ? "Describe a set arc and constraints. Copilot will return a proposal before creating anything."
      : `Plan from ${selectedTrack.title}. Copilot will return a proposal before creating anything.`;
    case "revise": return draft === null
      ? "Open a set draft to revise it with Copilot."
      : `Propose one change to ${draft.title} at revision ${draft.currentRevision}.`;
    case "explain": return "Ask for a grounded explanation using the selected local context.";
  }
}

function requestForMode(
  mode: CopilotMode,
  prompt: string,
  selectedTrack: CopilotSelectedTrack | null,
  draft: SetDraftSnapshot | null,
  explainSubject: ExplainSubject,
  intent: DiscoveryIntent,
): AssistantTaskRequest | null {
  switch (mode) {
    case "search": return selectedTrack === null
      ? { kind: "search", prompt }
      : { kind: "search", prompt, selectedTrackId: selectedTrack.id };
    case "plan": return selectedTrack === null
      ? { kind: "plan", prompt }
      : { kind: "plan", prompt, selectedTrackId: selectedTrack.id };
    case "revise": return draft === null ? null : {
      kind: "revise",
      prompt,
      draftId: draft.draftId,
      expectedRevision: draft.currentRevision,
    };
    case "explain": {
      if (explainSubject === "draft") return draft === null ? null : {
        kind: "explain",
        prompt,
        context: { kind: "draft", draftId: draft.draftId, expectedRevision: draft.currentRevision },
      };
      if (selectedTrack === null) return null;
      return explainSubject === "next"
        ? { kind: "explain", prompt, context: { kind: "next", selectedTrackId: selectedTrack.id, intent } }
        : { kind: "explain", prompt, context: { kind: "selected_track", selectedTrackId: selectedTrack.id } };
    }
  }
}

export function CopilotPanel({ api, selectedTrack, draft, knownTracks, onOpenDraft }: CopilotPanelProps) {
  const panelId = useId();
  const [authStatus, setAuthStatus] = useState<AssistantAuthStatus | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [mode, setMode] = useState<CopilotMode>("search");
  const [prompt, setPrompt] = useState("");
  const [explainSubject, setExplainSubject] = useState<ExplainSubject>("selected_track");
  const [intent, setIntent] = useState<DiscoveryIntent>("smooth");
  const [starting, setStarting] = useState(false);
  const [activeRequest, setActiveRequest] = useState<ActiveRequest | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [lastGoodResult, setLastGoodResult] = useState<CopilotCompletedResult | null>(null);
  const [pendingProposal, setPendingProposal] = useState<PendingProposal | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const statusSequence = useRef(0);
  const requestGeneration = useRef(0);
  const pendingSearchResult = useRef<AssistantSearchResult | null>(null);
  const pendingText = useRef("");
  const pendingProposalRef = useRef<AssistantProposal | null>(null);
  const lastGoodResultRef = useRef<CopilotCompletedResult | null>(null);
  const activeRequestRef = useRef<ActiveRequest | null>(activeRequest);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const tabRefs = useRef<Record<CopilotMode, HTMLButtonElement | null>>({
    search: null,
    plan: null,
    revise: null,
    explain: null,
  });

  activeRequestRef.current = activeRequest;

  const refreshStatus = useCallback(async () => {
    const sequence = ++statusSequence.current;
    setAuthBusy(true);
    setAuthStatus(CHECKING_STATUS);
    if (api === null) {
      setAuthStatus(UNAVAILABLE_STATUS);
      setAuthBusy(false);
      return;
    }
    try {
      const nextStatus = await api.getStatus();
      if (sequence === statusSequence.current) setAuthStatus(nextStatus);
    } catch {
      if (sequence === statusSequence.current) setAuthStatus(UNAVAILABLE_STATUS);
    } finally {
      if (sequence === statusSequence.current) setAuthBusy(false);
    }
  }, [api]);

  useEffect(() => {
    return () => {
      statusSequence.current += 1;
    };
  }, []);

  useEffect(() => () => {
    requestGeneration.current += 1;
  }, []);

  const modeAvailable: Record<CopilotMode, boolean> = {
    search: true,
    plan: true,
    revise: draft !== null,
    explain: selectedTrack !== null || draft !== null,
  };
  const activeMode: CopilotMode = modeAvailable[mode] ? mode : "search";

  const effectiveExplainSubject: ExplainSubject = explainSubject === "draft"
    ? (draft === null ? (selectedTrack === null ? "draft" : "selected_track") : "draft")
    : (selectedTrack === null ? "draft" : explainSubject);

  const focusPrompt = () => {
    promptRef.current?.focus();
  };

  const showFailure = (failure: AssistantFailure) => {
    const suffix = lastGoodResultRef.current === null ? "" : " Showing the last successful Copilot result.";
    setRequestError(`${failureMessage(failure.code)}${suffix}`);
    setNotice(null);
    setActivity(null);
    setStreamText("");
    setPendingProposal(null);
    pendingProposalRef.current = null;
    if (failure.code === "signed_out") {
      setAuthStatus({ state: "signed_out", auth: "none", message: "Sign in with ChatGPT to continue.", sdkVersion: null });
    } else if (failure.code === "unsupported_auth") {
      setAuthStatus({ state: "unsupported_auth", auth: "other", message: "Switch Codex to ChatGPT authentication.", sdkVersion: null });
    } else if (failure.code === "unavailable") {
      setAuthStatus(UNAVAILABLE_STATUS);
    }
  };

  useEffect(() => {
    if (activeRequest === null || api === null) return;
    const request = activeRequest;
    let stopped = false;
    let timer: number | undefined;
    let sequence = 0;

    const poll = async () => {
      try {
        const result = await api.poll(request.requestId, sequence);
        if (stopped || requestGeneration.current !== request.generation) return;
        sequence = result.nextSequence;
        let terminalHandled = false;

        for (const event of result.events) {
          switch (event.type) {
            case "activity":
              setActivity(ACTIVITY_LABELS[event.activity]);
              break;
            case "text_snapshot":
              pendingText.current = event.text;
              setStreamText(event.text);
              break;
            case "search_result":
              pendingSearchResult.current = event.result;
              break;
            case "proposal":
              pendingProposalRef.current = event.proposal;
              setPendingProposal({ requestId: request.requestId, proposal: event.proposal });
              break;
            case "completed": {
              terminalHandled = true;
              let completedResult: CopilotCompletedResult | null = null;
              if (request.mode === "search" && pendingSearchResult.current !== null) {
                completedResult = { kind: "search", result: pendingSearchResult.current };
              } else if (request.mode === "explain" && pendingText.current.trim() !== "") {
                completedResult = { kind: "explanation", text: pendingText.current, evidenceTrackIds: event.evidenceTrackIds };
              } else if ((request.mode === "plan" || request.mode === "revise") && pendingProposalRef.current === null && pendingText.current.trim() !== "") {
                completedResult = { kind: "unsupported", text: pendingText.current };
              }

              if (completedResult !== null) {
                lastGoodResultRef.current = completedResult;
                setLastGoodResult(completedResult);
                setRequestError(null);
                setNotice(null);
              } else if ((request.mode === "plan" || request.mode === "revise") && pendingProposalRef.current !== null) {
                setRequestError(null);
                setNotice("Proposal ready for review.");
              } else {
                showFailure({ code: "invalid_response", message: "The request ended without a complete result." });
              }
              setActivity(null);
              setStreamText("");
              setActiveRequest(null);
              break;
            }
            case "cancelled":
              terminalHandled = true;
              setNotice("Copilot request cancelled. Nothing was changed.");
              setRequestError(null);
              setActivity(null);
              setStreamText("");
              setPendingProposal(null);
              pendingProposalRef.current = null;
              setActiveRequest(null);
              focusPrompt();
              break;
            case "failed":
              terminalHandled = true;
              showFailure(event.error);
              setActiveRequest(null);
              break;
          }
        }

        if (result.terminal) {
          if (!terminalHandled) {
            showFailure({ code: "invalid_response", message: "The request ended without a terminal event." });
            setActiveRequest(null);
          }
          return;
        }
        timer = window.setTimeout(() => { void poll(); }, POLL_DELAY_MS);
      } catch {
        if (stopped || requestGeneration.current !== request.generation) return;
        const suffix = lastGoodResultRef.current === null ? "" : " Showing the last successful Copilot result.";
        setRequestError(`Copilot could not complete the request. Nothing was changed.${suffix}`);
        setNotice(null);
        setActivity(null);
        setStreamText("");
        setPendingProposal(null);
        pendingProposalRef.current = null;
        setActiveRequest(null);
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeRequest, api]);

  const beginLogin = async () => {
    if (api === null || authBusy) return;
    const sequence = ++statusSequence.current;
    setAuthBusy(true);
    setAuthStatus(CHECKING_STATUS);
    try {
      const nextStatus = await api.beginLogin();
      if (sequence === statusSequence.current) setAuthStatus(nextStatus);
    } catch {
      if (sequence === statusSequence.current) setAuthStatus(UNAVAILABLE_STATUS);
    } finally {
      if (sequence === statusSequence.current) setAuthBusy(false);
    }
  };

  const chooseMode = (nextMode: CopilotMode, moveFocus = false) => {
    if (!modeAvailable[nextMode]) return;
    setMode(nextMode);
    setRequestError(null);
    setNotice(null);
    if (moveFocus) tabRefs.current[nextMode]?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const enabled = MODES.filter(({ mode: candidate }) => modeAvailable[candidate]).map(({ mode: candidate }) => candidate);
    const currentIndex = enabled.indexOf(activeMode);
    let target: CopilotMode | undefined;
    if (event.key === "ArrowRight") target = enabled[(currentIndex + 1) % enabled.length];
    else if (event.key === "ArrowLeft") target = enabled[(currentIndex - 1 + enabled.length) % enabled.length];
    else if (event.key === "Home") target = enabled[0];
    else if (event.key === "End") target = enabled.at(-1);
    if (target === undefined) return;
    event.preventDefault();
    chooseMode(target, true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt === "") {
      setRequestError("Enter a request for Copilot.");
      return;
    }
    const request = requestForMode(activeMode, trimmedPrompt, selectedTrack, draft, effectiveExplainSubject, intent);
    if (request === null) {
      setRequestError(modeDescription(activeMode, selectedTrack, draft));
      return;
    }
    if (
      api === null
      || authBusy
      || (authStatus !== null && authStatus.state !== "ready")
      || activeRequest !== null
      || starting
      || pendingProposal !== null
    ) return;

    const generation = ++requestGeneration.current;
    pendingSearchResult.current = null;
    pendingText.current = "";
    pendingProposalRef.current = null;
    setStarting(true);
    setActivity("Starting Copilot…");
    setStreamText("");
    setPendingProposal(null);
    setRequestError(null);
    setNotice(null);
    try {
      const result = await api.start(request);
      if (requestGeneration.current !== generation) return;
      setActiveRequest({ requestId: result.requestId, mode: activeMode, generation });
    } catch {
      if (requestGeneration.current !== generation) return;
      const suffix = lastGoodResultRef.current === null ? "" : " Showing the last successful Copilot result.";
      setRequestError(`Copilot could not start the request. Nothing was changed.${suffix}`);
      setActivity(null);
    } finally {
      if (requestGeneration.current === generation) setStarting(false);
    }
  };

  const cancel = async () => {
    if (api === null || activeRequest === null || cancelling) return;
    const request = activeRequest;
    setCancelling(true);
    try {
      const result = await api.cancel(request.requestId);
      if (activeRequestRef.current?.requestId !== request.requestId) return;
      if (result.status === "already_terminal") {
        setNotice("Copilot has finished; loading the final result.");
        return;
      }
      requestGeneration.current += 1;
      setActiveRequest(null);
      setActivity(null);
      setStreamText("");
      setPendingProposal(null);
      pendingProposalRef.current = null;
      if (result.status === "cancelled") {
        setRequestError(null);
        setNotice("Copilot request cancelled. Nothing was changed.");
      } else {
        setNotice(null);
        setRequestError("The Copilot request was no longer available. Nothing was changed.");
      }
      focusPrompt();
    } catch {
      setRequestError("Copilot could not cancel the request. Wait for it to finish before trying again.");
    } finally {
      setCancelling(false);
    }
  };

  const discardProposal = () => {
    pendingProposalRef.current = null;
    setPendingProposal(null);
    setRequestError(null);
    setNotice("Proposal discarded. Nothing changed.");
    focusPrompt();
  };

  const confirmProposal = async () => {
    if (api === null || pendingProposal === null || confirming || activeRequest !== null) return;
    const currentProposal = pendingProposal;
    setConfirming(true);
    setRequestError(null);
    setNotice(null);
    try {
      const result = await api.confirm(currentProposal.requestId, currentProposal.proposal.proposalId);
      pendingProposalRef.current = null;
      setPendingProposal(null);
      if (result.status === "created" || result.status === "updated") {
        onOpenDraft(result.snapshot);
        setNotice(`Proposal confirmed. Opened ${result.snapshot.title}.`);
      } else if (result.status === "unchanged") {
        onOpenDraft(result.snapshot);
        setNotice(`No draft change was needed. Refreshed ${result.snapshot.title}.`);
      } else if (result.status === "conflict") {
        setRequestError(`Draft changed before confirmation. Current revision is ${result.currentRevision}. Nothing was overwritten.`);
      } else {
        setRequestError(blockedConfirmationMessage(result.code));
      }
    } catch {
      pendingProposalRef.current = null;
      setPendingProposal(null);
      setRequestError("The confirmation result could not be verified. Reopen your drafts before trying again.");
    } finally {
      setConfirming(false);
      focusPrompt();
    }
  };

  const citationTracks = new Map<string, { id: string; title: string | null; artist: string | null }>();
  for (const track of knownTracks) citationTracks.set(track.id, track);
  if (selectedTrack !== null) citationTracks.set(selectedTrack.id, selectedTrack);
  for (const entry of draft?.entries ?? []) {
    if (entry.track !== null) citationTracks.set(entry.track.id, entry.track);
  }

  const busy = starting || activeRequest !== null;
  const runDisabled = api === null
    || authBusy
    || (authStatus !== null && authStatus.state !== "ready")
    || busy
    || pendingProposal !== null;
  const descriptionId = `${panelId}-description`;
  const promptErrorId = `${panelId}-error`;

  return (
    <section className="copilot-panel" aria-labelledby={`${panelId}-title`}>
      <header className="copilot-panel__heading">
        <div>
          <p className="eyebrow">Local evidence · ChatGPT authentication</p>
          <h2 id={`${panelId}-title`}>Copilot</h2>
        </div>
        <div className={`copilot-auth copilot-auth--${authStatus?.state ?? "unchecked"}`}>
          <div className="copilot-auth__state" role="status" aria-label="Copilot authentication status" aria-live="polite">
            <strong>{statusTitle(authStatus)}</strong>
            <span>{authStatus?.message ?? "No Codex status check has run. Check status, sign in, or run Copilot when ready."}</span>
            {authStatus?.state === "ready" ? <span>Codex SDK {authStatus.sdkVersion}</span> : null}
          </div>
          <div className="copilot-auth__actions">
            <button type="button" className="copilot-button" disabled={authBusy || api === null} onClick={() => { void refreshStatus(); }}>Refresh Copilot status</button>
            {authStatus === null || authStatus.state === "signed_out" || authStatus.state === "unsupported_auth" ? (
              <button type="button" className="copilot-button copilot-button--primary" disabled={authBusy || api === null} onClick={() => { void beginLogin(); }}>Sign in with ChatGPT</button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="copilot-tabs" role="tablist" aria-label="Copilot mode">
        {MODES.map(({ mode: candidateMode, label }) => (
          <button
            key={candidateMode}
            ref={(element) => { tabRefs.current[candidateMode] = element; }}
            id={`${panelId}-tab-${candidateMode}`}
            type="button"
            role="tab"
            aria-selected={activeMode === candidateMode}
            aria-controls={`${panelId}-workspace`}
            tabIndex={activeMode === candidateMode ? 0 : -1}
            disabled={!modeAvailable[candidateMode]}
            onClick={() => chooseMode(candidateMode)}
            onKeyDown={onTabKeyDown}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="copilot-context-limitations" aria-live="polite">
        {draft === null ? <p>Open a set draft to revise it with Copilot.</p> : null}
        {selectedTrack === null && draft === null ? <p>Explore a track or open a draft to ask for an explanation.</p> : null}
      </div>

      <div
        id={`${panelId}-workspace`}
        className="copilot-workspace"
        role="tabpanel"
        aria-labelledby={`${panelId}-tab-${activeMode}`}
        aria-busy={busy}
      >
        <p id={descriptionId} className="copilot-mode-description">{modeDescription(activeMode, selectedTrack, draft)}</p>

        {activeMode === "explain" ? (
          <div className="copilot-context-controls">
            <label className="copilot-field">
              <span>Explanation context</span>
              <select aria-label="Explanation context" value={effectiveExplainSubject} onChange={(event) => setExplainSubject(event.currentTarget.value as ExplainSubject)}>
                <option value="selected_track" disabled={selectedTrack === null}>Selected track</option>
                <option value="next" disabled={selectedTrack === null}>Next-track recommendation</option>
                <option value="draft" disabled={draft === null}>Open draft</option>
              </select>
            </label>
            {effectiveExplainSubject === "next" ? (
              <label className="copilot-field">
                <span>Transition intent</span>
                <select aria-label="Transition intent" value={intent} onChange={(event) => setIntent(event.currentTarget.value as DiscoveryIntent)}>
                  {INTENTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}

        <form className="copilot-form" onSubmit={(event) => { void submit(event); }}>
          <label className="copilot-field copilot-field--prompt">
            <span>Ask Copilot</span>
            <textarea
              ref={promptRef}
              aria-describedby={`${descriptionId}${requestError === null ? "" : ` ${promptErrorId}`}`}
              maxLength={2_000}
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              placeholder={activeMode === "search" ? "Find warm tracks under 125 BPM…" : activeMode === "plan" ? "Build a one-hour set that rises steadily…" : activeMode === "revise" ? "Move the peak later without changing pinned tracks…" : "Explain why this evidence supports the recommendation…"}
            />
          </label>
          <div className="copilot-form__footer">
            <span className="copilot-character-count">{prompt.length.toLocaleString("en-US")} / 2,000</span>
            <div className="copilot-actions">
              <button type="submit" className="copilot-button copilot-button--primary" disabled={runDisabled}>Run Copilot</button>
              {activeRequest === null ? null : (
                <button type="button" className="copilot-button" disabled={cancelling} onClick={() => { void cancel(); }}>{cancelling ? "Cancelling…" : "Cancel Copilot"}</button>
              )}
            </div>
          </div>
        </form>

        {activity === null ? null : <p className="copilot-activity" role="status" aria-live="polite">{activity}</p>}
        {streamText === "" ? null : (
          <section className="copilot-stream" aria-label="Copilot streamed response" aria-live="polite">
            <p>{streamText}</p>
          </section>
        )}
        {requestError === null ? null : <p id={promptErrorId} className="copilot-message copilot-message--error" role="alert">{requestError}</p>}
        {notice === null ? null : <p className="copilot-message copilot-message--success" role="status" aria-live="polite">{notice}</p>}
        {lastGoodResult === null ? null : <CopilotResult value={lastGoodResult} knownTracks={Array.from(citationTracks.values())} />}
        {pendingProposal === null ? null : (
          <CopilotProposal
            proposal={pendingProposal.proposal}
            active={activeRequest !== null}
            confirming={confirming}
            onConfirm={() => { void confirmProposal(); }}
            onDiscard={discardProposal}
          />
        )}
      </div>
    </section>
  );
}
