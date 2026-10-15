# L2 stream provenance v6

`lastExchangeTime`, `book.lastPrice` and `session` cumulative fields now refer to
the accepted **snapshot**. They are never advanced by trade/order callbacks.
`book` and `session` carry their own source and receipt metadata. Raw quantity
units remain provider units; this release does not certify volume/amount units.

`streams.snapshot`, `.transaction` and `.order` expose independent accepted source
times, accepted receipt times, latest parsed receipt times, received/accepted/
duplicate/out-of-order/ambiguous-time counts and optional sequence/channel.
Legacy `messages` counts parsed records including rejected records, not unique
trades. A sequence watermark is scoped by stream, day and channel. Source time
cannot rewind within a stream. Missing-sequence records receive bounded exact
deduplication; conflicting same-time records without a sequence are rejected as
ambiguous rather than guessed to be later revisions. Dedup memory is bounded to
4096 identities. No complete tick ledger or certified uniqueness is claimed.

`latestTrade` is separate from snapshot price and volume. `tradeEvents` retains
at most 128 accepted trade records with process-local ids and a connection
generation. It is a bounded observation window, not a gap-free delivery protocol.
An id gap, process restart, disconnect or generation change requires a new
baseline; clients must not reconstruct cumulative volume from this window.

Availability requires a connected transport, an event accepted in the current
generation, an accepted receipt within the existing collector stale threshold,
and source time no more than that threshold behind the accepted snapshot.
`sourceLagToSnapshotSeconds` is a relative source-clock comparison, not measured
exchange-to-browser latency. Source freshness is explicitly uncertified.
Disconnected or absent streams are unavailable. Transport reconnect retains
ordering watermarks, clears fast flow/book windows and the partial-minute and
confirmation buffers, retains outstanding cooldown deadlines even after stale
intervals, and waits for new accepted data. API receipt-age checks also prevent
an old state file from presenting fresh stream metadata.

The existing 250ms collector publish default, 250ms API cache and 300ms SSE or
fallback polling cadence remain unchanged. No subsecond update guarantee is
made. Old JSON responses remain readable with provenance marked unavailable.
The frontend ignores older response versions and shows source/freshness details
in an expandable section. This change does not alter trading authorization.

KDJ retains the canonical 9/3/3 defaults, seeds 50 and full-window warmup. Real
OHLC and explicit completed/available bars are required; repeated observations
or successor labels alone do not certify provider completion. The public minute
provider remains a blocked candidate source until its completion contract is
proved. This release does not promote it to formal live signals.

Release identification follows the existing 12-character build commit exposed
by `/api/control/version`; `version` repeats that value, while `contracts`
exposes `kdj-ohlc-continuous-50-v1` and `per-stream-v6` for public verification.
