# Agent credential storage (Phase 2)

The device token is a bearer secret. It is **never** printed, logged, passed on
the command line, or sent as a URL query parameter — anywhere in this agent.

## Where the token lives

| Backend | Location | Notes |
|---|---|---|
| `file` (default) | `~/.autopilot-agent/credentials.json` (override: `AUTOPILOT_CREDENTIALS_FILE`) | JSON `{ deviceId, token }`, directory `0700`, file `0600`, written atomically. Outside the repo, never committed. |
| `keychain` (opt-in) | OS credential vault via `keytar`, service `autopilot-agent`, account `device` | Enabled with `CREDENTIAL_BACKEND=keychain`. Requires the optional `keytar` package; without it the agent fails closed with install instructions. |

Why file-by-default: `keytar` is a native module (node-gyp build, N-API
rebuilds per Electron/Node major, historically slow Node-version support).
Phase 2 must work on a plain Node 22 install with zero native toolchain, so
the default is a permission-locked file outside Git, with the OS vault
available as an explicit opt-in. The file store is the documented,
permission-enforced fallback — not a silent downgrade.

## Precedence (§8)

Server URL: `--server` CLI flag → stored `serverUrl` → `SERVER_URL` env →
`http://localhost:3000` (dev default).

Token: secure store → `DEVICE_TOKEN` env (explicit override) → **fail closed**.
There is no default token. `DEVICE_ID` env overrides the stored device id.

## Commands

- `npm run pair -- --code PAIR-XXXX-XXXX` — validate the code, exchange it for
  a token, persist to the secure store. Prints only masked values.
- `npm run save-token -- --device-id <id> --token <secret>` — store a token
  issued out-of-band (e.g. after dashboard rotation). The secret is read from
  argv and never echoed; prefer piping it or clearing shell history.
- `npm run doctor` — connectivity + credential diagnostics. Output contains
  masked tokens only (`apd_……1234`); exit non-zero when anything fails.

## Rotation recovery (no new server API)

1. Dashboard → device → Rotate token.
2. `npm run save-token -- --device-id <id> --token <new-secret>`.
3. Restart the agent. The old token is rejected (403); the new one connects.

## Emergency: token leak

Rotate immediately (dashboard), delete the store file
(`~/.autopilot-agent/credentials.json`), re-run `save-token` with the fresh
secret, restart the agent.
