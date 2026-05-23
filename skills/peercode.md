---
name: peercode
description: Distributed context consensus for parallel development. Use when working as one of several Claude Code sessions on a shared PeerCode project — to sync context, lock files, debate conflicts, and coordinate pushes to the peer-progress branch.
---

# PeerCode Skill

You are one of several Claude Code sessions building a project in parallel. You coordinate with your teammates through the PeerCode server's MCP tools. Your job is to keep your context in sync with theirs and avoid stepping on each other's work.

## Connecting

The PeerCode server exposes its tools over the **Streamable HTTP** MCP transport at `http://<server>/mcp`. Every tool call must include a stable **`sessionId`** that identifies you (e.g. your name: `alice`). Use the SAME `sessionId` for the whole project so your locks, deltas, and sync records line up. Most tools also take a `projectId`.

## Core rules

1. **Sync before you work.** Call `peercode_get_deltas` first. If `requiresAction` is true, a peer's change conflicts with active work — read it before continuing.
2. **Lock before you edit.** Call `peercode_lock_file` for any file/range you'll change. Lock the smallest reasonable scope. If it's rejected, the response names the holder — wait, ask them to release, or open a debate. Call `peercode_heartbeat` periodically (within ~5 min) to keep a long-held lock; release with `peercode_release_lock` when done.
3. **Broadcast significant discoveries.** When you change an interface contract, find a new dependency, pivot strategy, or discover a scope change, call `peercode_push_delta`. Do NOT broadcast routine, local-only realizations — that's just noise.
4. **Debate real conflicts.** If a peer's delta contradicts work you've already built, call `peercode_start_debate` with your position, constraints, and proposed alternatives. Respond with `peercode_respond_debate`. State constraints concretely; propose alternatives that satisfy both sides. Set `proposeResolution: true` when you genuinely agree — when both sides do so in turn, the debate resolves. After 5 rounds, or if you're truly stuck, set `escalateToHuman: true`.

## Git is YOURS, not the server's

The server **never** touches git. **You** run `git add/commit/pull/push` against the `peer-progress` branch yourself. The server only *coordinates* so pushes don't collide:

- Before pushing: call `peercode_sync_github` with `action: "start"`. It returns either `status: "go"` (you hold the sync token) plus `pullShas` — the peer commits to `git pull` first — or it throws `sync_busy` (another session is mid-push; wait and retry).
- Then locally: `git pull` those commits, resolve any conflicts, `git push origin peer-progress`.
- After pushing: call `peercode_sync_github` with `action: "complete"` and your new `commitSha`. This releases the token and tells peers to pull.

### Merge points

A merge point is a **phase-boundary sync barrier** — NOT a merge to `main` and NOT a pull request. It's reached when every session working the phase has pushed and pulled the same `peer-progress` HEAD, so everyone is in sync before the next phase. The server locks the phase's interface contracts at that point. There is no GitHub PR step.

## Web search — debates and planning ONLY

`peercode_web_search` (backed by Nimble) is available **only** for two purposes:
- grounding a **debate** in current facts (e.g. "does framework X actually support Y?"), and
- answering **planning** questions.

Do not use it for general documentation lookups during routine coding. Do not use any other web-search/docs tool (e.g. context7) for PeerCode work.

## MCP tools

| Tool | Purpose |
|------|---------|
| `peercode_get_project` | Full project state (phases, tasks, locks, deltas, debates, sessions) |
| `peercode_get_deltas` | Pending context updates; `requiresAction` flags conflicts |
| `peercode_push_delta` | Broadcast a discovery/contract change/dependency/scope change |
| `peercode_ack_delta` | Acknowledge a non-conflicting delta |
| `peercode_lock_file` / `peercode_release_lock` / `peercode_heartbeat` | File/range locking |
| `peercode_start_debate` / `peercode_respond_debate` / `peercode_get_debate` | Structured conflict negotiation |
| `peercode_sync_github` | Coordinate (not perform) your push to peer-progress |
| `peercode_web_search` | Nimble web search — debates & planning only |

## Typical loop

1. `peercode_get_deltas` → integrate or debate.
2. `peercode_lock_file` the files you'll touch.
3. Work. `peercode_push_delta` on significant discoveries. `peercode_heartbeat` to hold locks.
4. `peercode_sync_github start` → `git pull`/resolve/`git push` → `peercode_sync_github complete`.
5. `peercode_release_lock`.
