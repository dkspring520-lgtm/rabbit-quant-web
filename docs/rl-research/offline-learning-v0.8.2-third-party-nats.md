# Offline Learning V0.8.2 Third-Party Level2 NATS Adapter

The project’s confirmed market-data path is the third-party Base32 Level2 NATS service, not QMT/XtData. Existing collector configuration and subjects are reused:

- `L2_NATS_URL` / `L2_NATS_URLS`
- `L2_NATS_USER` / `L2_NATS_PASSWORD`
- `stk.l2.601899.SH`
- `stk.trans.601899.SH`
- `stk.order.601899.SH`

`ThirdPartyNatsMarketDataAdapter` keeps the V0.8 core independent of the NATS protocol, normalizes raw messages into `MarketDataEvent`, preserves source timestamps and receive time, and reports connection, subscription, decode, unknown-event, and disconnect failures. It does not invent payload fields or claim a valid 1m bar when only a snapshot/order message is available.

Run the runtime probe with `npm run shadow:nats`. It reports `NATS_CONFIG_MISSING`, `NATS_CONNECT_FAILED`, `NATS_SUBSCRIBE_FAILED`, or `NO_MARKET_DATA` when the environment is incomplete or no messages arrive. Credentials and provider details are not committed.

Current gate: **NATS_ADAPTER_READY** means the adapter code and confirmed subject wiring exist. `LIVE_SHADOW_RUNTIME_VERIFIED` requires a real authenticated run receiving `601899.SH` messages and successfully building validated closed 1m bars. Until that run succeeds, the research status remains **RESEARCH_BLOCKED**.
