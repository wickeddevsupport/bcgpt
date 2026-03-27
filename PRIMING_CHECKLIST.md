# PMOS Priming Checklist

## TODO List #1 — Baseline Separation + Runtime Sanity

- [x] Capture PMOS runtime snapshot (config + container + timestamped backup)
- [~] Enforce canonical agent/workspace structure in PMOS config (PMOS uses workspace-native config; global config is not authoritative)
- [x] Verify Discord non-mention behavior config is explicit
- [x] Verify Telegram config is present and not duplicated at runtime (no PMOS telegram polling conflict observed)
- [x] Validate channels + runtime health after restart
- [x] Record results in PRIMING_REPORT.md

## TODO List #2 — Routing + Workspace Isolation Verification
- [x] Validate bindings and route determinism
- [x] Verify per-agent session stores and agentDir isolation
- [x] Run commander→delegate orchestration smoke test

## TODO List #3 — Productization Pre-Hardening Acceptance
- [ ] End-to-end channel behavior tests (Discord/Telegram/Webchat)
- [ ] Manual Coolify deploy + smoke + rollback check
- [ ] Freeze baseline config template for prod/staging/dev
