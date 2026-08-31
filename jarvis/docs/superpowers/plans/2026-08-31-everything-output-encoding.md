# Everything Output Encoding Implementation Plan

1. Add deterministic byte-decoding tests for UTF-8, CP866, Windows-1251,
   ASCII, and invalid CSV output.
2. Change the ES process adapter to capture buffers and decode stdout/stderr at
   the boundary. Use strict UTF-8 first, then rank CP866 and Windows-1251 by
   CSV/path validity and agreement with the requested filename.
3. Preserve the current provider failure and restricted-search fallback
   contracts.
4. Run adapter, file command, Tool Gateway, and voice-provider tests plus a
   live Cyrillic folder search.
5. Restart Jarvis and verify both Jarvis and Everything processes.
