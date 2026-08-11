# Generated-audio analysis feasibility spike

This is a Python-standard-library-only proof over generated mono signed-16-bit PCM WAV fixtures. The generator yields bounded PCM chunks rather than materializing complete signals. `analyze_file` streams small frame chunks, reports elementary amplitude/energy measurements, and infers a 120 BPM interval only from deterministic synthetic click boundaries. Its confidence is `min(1, interval_count / 8) * max(0, 1 - mean(abs(interval - median)) / median)`: a transparent count-and-regularity score for this fixture, not musical confidence.

`analyze_batch` launches one process per input sequentially. A worker first signals `ready`; a bounded startup timeout applies only to that handshake. The per-file wall timeout starts only after `ready`, so interpreter startup time cannot consume analysis time. It returns success, error, startup-timeout, or timeout without preventing later inputs. Process and queue resources are terminated/joined/closed in `finally` for every item.

`validate_model_asset` is deliberately validation only: it permits an existing, hash-allowlisted non-executable asset under an application-owned root and rejects symlink escapes, arbitrary paths, unknown hashes, and `.pickle`/`.pkl`/`.pt`/`.pth`. This spike has no loader, no model, no dependency, and no network access.

This is **not production MIR**. It cannot establish tempo, beat tracking, loudness, key, structure, or confidence quality for music. It only provides reproducible Phase 0 evidence that the intended safety and isolation boundaries are technically feasible on a synthetic fixture.
