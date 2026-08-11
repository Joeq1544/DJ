interface ImportPanelProps {
  importing: boolean;
  onImport: () => void;
}

export function ImportPanel({ importing, onImport }: ImportPanelProps) {
  return (
    <header className="library-toolbar">
      <div>
        <p className="eyebrow">Rekordbox collection</p>
        <h1>Library</h1>
      </div>
      <button className="import-button" type="button" disabled={importing} onClick={onImport}>
        {importing ? "Importing Rekordbox XML…" : "Import Rekordbox XML"}
      </button>
    </header>
  );
}
