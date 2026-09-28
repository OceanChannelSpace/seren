# SEREN MVP — Delivery Runbook

**Status (2026-09-27 ~20:39 EDT): DELIVERED.** Branch
`seren/mvp-working-build` pushed; PR #1 "SEREN MVP — working build" opened at
https://github.com/OceanChannelSpace/seren/pull/1. The 6 local commits were
cherry-picked onto canonical `origin/main` (bbb7533) to give the PR shared
history; original `index.html` prototype preserved at
`docs/legacy-prototype/index.html`. Goal `goal_c273e3d38e6f` closed.

Archive note: delivery used the GitHub OAuth device flow
(`device.py start`/`deliver`) after the hosted connector cards failed.

## What's ready
- Branch: `seren/mvp-working-build` in `~/workspace/seren-mvp`
- 5 focused commits, clean tree, tests 36/36 passing
- Docs: README, API contract, product truth, audit

## To finish delivery (one session)
1. Get a working GitHub credential. In order of preference:
   a. **Device flow** (no secrets leave GitHub):
      `python3 ~/workspace/skills/github/bin/device.py start` → user opens
      https://github.com/login/device, enters code, authorizes "GitHub CLI".
      Then `python3 ~/workspace/skills/github/bin/device.py deliver`.
      State persists in `~/workspace/skills/github/.device_state.json`
      (survives VM restarts; /tmp does not).
   b. **Secure Vault login card** for github.com → browser task signs in as the
      user and completes the push/PR in the live browser.
   c. **Fresh classic PAT** (repo scope) via `credentials.request_api_access`.
2. `deliver` (or manual equivalent) will: fetch canonical `origin/main`,
   preserve its `index.html` prototype at `docs/legacy-prototype/index.html`,
   rebase/cherry-pick the 5 local commits onto canonical main if histories
   diverged, re-run tests, push the branch, open the PR.
3. Verify live branch + PR URLs, send them to the user, then mark
   `goal_c273e3d38e6f` complete.

## Known dead ends (do not retry)
- `custom.github` connector: 401 bad credentials.
- `custom.github-seren` connector: exists but policy 403s sandbox use;
  `connector.read` is read-only (no push/PR).
- Perplexity GitHub connector: read-only.
- Managed Chromium cannot reach the shell-hosted dev server (network-isolated
  browser VM) — irrelevant for github.com delivery.
