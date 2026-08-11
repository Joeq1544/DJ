# Rekordbox XML feasibility spike

This Phase 0 proof consumes only the synthetic fixture and uses Python's standard library. It does not read Rekordbox databases, open audio, write XML, or provide a production import layer. “Immutable” here means the source XML is never mutated and canonical serialized output is deterministic. The returned JSON-compatible Python dict/list values are intentionally mutable; this spike does not introduce an immutable object model.

Run the focused check from the repository root:

```sh
python3 -m unittest discover -s spikes/rekordbox_xml/tests -v
```
