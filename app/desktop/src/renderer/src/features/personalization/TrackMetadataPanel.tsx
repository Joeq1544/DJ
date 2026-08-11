import { useEffect, useRef, useState } from "react";
import type {
  DesktopApi,
  PreferenceProfile,
  TrackListItem,
  TrackMetadata,
  TrackMetadataUpdateRequest,
} from "../../../../shared/contracts";

interface TrackMetadataPanelProps {
  api: DesktopApi | null;
  track: TrackListItem;
  onClose: () => void;
  onSaved: (metadata: TrackMetadata) => void;
  onProfile: (profile: PreferenceProfile) => void;
}

interface MetadataDraft {
  rating: string;
  tags: string;
  note: string;
}

function displayTitle(track: TrackListItem): string {
  return track.title ?? "Untitled track";
}

function draftFromMetadata(metadata: Pick<TrackMetadata, "rating" | "tags" | "note">): MetadataDraft {
  return {
    rating: metadata.rating === null ? "" : String(metadata.rating),
    tags: metadata.tags.join(", "),
    note: metadata.note ?? "",
  };
}

function metadataFromTrack(track: TrackListItem): TrackMetadata {
  return {
    trackId: track.id,
    ...track.userMetadata,
    updatedAt: "",
  };
}

function normalizedTags(value: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const rawTag of value.split(",")) {
    const tag = rawTag.normalize("NFKC").trim();
    if (tag === "") continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function requestFromDraft(trackId: string, draft: MetadataDraft): TrackMetadataUpdateRequest {
  const tags = normalizedTags(draft.tags);
  if (tags.length > 20) throw new Error("Use no more than 20 tags.");
  if (tags.some((tag) => tag.length > 40)) throw new Error("Each tag must be 40 characters or fewer.");
  const note = draft.note.trim();
  return {
    trackId,
    rating: draft.rating === "" ? null : Number(draft.rating),
    tags,
    note: note === "" ? null : note,
  };
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function TrackMetadataPanel({ api, track, onClose, onSaved, onProfile }: TrackMetadataPanelProps) {
  const title = displayTitle(track);
  const [saved, setSaved] = useState<TrackMetadata>(() => metadataFromTrack(track));
  const [draft, setDraft] = useState<MetadataDraft>(() => draftFromMetadata(track.userMetadata));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedbackAction, setFeedbackAction] = useState<"liked" | "disliked" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [track.id]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    let active = true;
    setLoading(true);
    setError(null);
    setMessage(null);
    const fallback = metadataFromTrack(track);
    setSaved(fallback);
    setDraft(draftFromMetadata(fallback));
    if (api === null) {
      setLoading(false);
      setError("The secure desktop connection is unavailable. Showing the last library value.");
      return () => { active = false; };
    }
    void api.library.getTrackMetadata(track.id)
      .then((metadata) => {
        if (!active || sequence !== requestSequence.current) return;
        setSaved(metadata);
        setDraft(draftFromMetadata(metadata));
      })
      .catch((loadError: unknown) => {
        if (!active || sequence !== requestSequence.current) return;
        setError(`${readableError(loadError, "Personal details could not be loaded.")} Showing the last library value.`);
      })
      .finally(() => {
        if (active && sequence === requestSequence.current) setLoading(false);
      });
    return () => {
      active = false;
      requestSequence.current += 1;
    };
  }, [api, track.id]);

  const save = async () => {
    if (api === null || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.library.updateTrackMetadata(requestFromDraft(track.id, draft));
      setSaved(result);
      setDraft(draftFromMetadata(result));
      setMessage("Personal details saved.");
      onSaved(result);
    } catch (saveError) {
      setDraft(draftFromMetadata(saved));
      setError(readableError(saveError, "Personal details could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const record = async (type: "liked" | "disliked") => {
    if (api === null || feedbackAction !== null) return;
    setFeedbackAction(type);
    setError(null);
    setMessage(null);
    try {
      const result = await api.preferences.recordFeedback({ type, trackId: track.id });
      onProfile(result.profile);
      setMessage(type === "liked" ? "Like recorded." : "Dislike recorded.");
    } catch (feedbackError) {
      setError(readableError(feedbackError, "Feedback could not be recorded."));
    } finally {
      setFeedbackAction(null);
    }
  };

  const busy = loading || saving || feedbackAction !== null;

  return (
    <section className="personal-panel track-metadata-panel" aria-labelledby="track-metadata-heading" aria-busy={loading}>
      <div className="personal-panel__heading">
        <div>
          <p className="eyebrow">Your library layer</p>
          <h2 id="track-metadata-heading" ref={headingRef} tabIndex={-1}>Personal details for {title}</h2>
        </div>
        <button type="button" className="personal-button" onClick={onClose}>Close personal details</button>
      </div>

      {loading ? <p className="personal-status" role="status" aria-live="polite">Loading personal details…</p> : null}

      <div className="metadata-form">
        <label className="personal-field">
          <span>Rating</span>
          <select
            value={draft.rating}
            disabled={loading || saving}
            onChange={(event) => {
              const rating = event.currentTarget.value;
              setDraft((current) => ({ ...current, rating }));
            }}
          >
            <option value="">No rating</option>
            <option value="1">1 star</option>
            <option value="2">2 stars</option>
            <option value="3">3 stars</option>
            <option value="4">4 stars</option>
            <option value="5">5 stars</option>
          </select>
        </label>
        <label className="personal-field">
          <span>Tags</span>
          <input
            type="text"
            aria-label="Tags"
            value={draft.tags}
            disabled={loading || saving}
            onChange={(event) => {
              const tags = event.currentTarget.value;
              setDraft((current) => ({ ...current, tags }));
            }}
            placeholder="Warm, Vocal, Closer"
          />
          <small>Separate up to 20 tags with commas.</small>
        </label>
        <label className="personal-field personal-field--notes">
          <span>Notes</span>
          <textarea
            maxLength={2_000}
            rows={3}
            value={draft.note}
            disabled={loading || saving}
            onChange={(event) => {
              const note = event.currentTarget.value;
              setDraft((current) => ({ ...current, note }));
            }}
          />
        </label>
      </div>

      <div className="personal-actions">
        <button type="button" className="personal-button personal-button--primary" disabled={busy || api === null} onClick={() => { void save(); }}>
          {saving ? "Saving personal details…" : "Save personal details"}
        </button>
        <button type="button" className="personal-button" disabled={busy || api === null} onClick={() => { void record("liked"); }}>
          {feedbackAction === "liked" ? "Recording like…" : `Like ${title}`}
        </button>
        <button type="button" className="personal-button" disabled={busy || api === null} onClick={() => { void record("disliked"); }}>
          {feedbackAction === "disliked" ? "Recording dislike…" : `Dislike ${title}`}
        </button>
      </div>

      {message === null ? null : <p className="personal-status personal-status--success" role="status" aria-live="polite">{message}</p>}
      {error === null ? null : <p className="personal-status personal-status--error" role="alert">{error}</p>}
    </section>
  );
}
