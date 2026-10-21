# Oak Hill Agent Notes

## Change boundary (operator rule, 2026-10-21)

**Code changes you make must apply to this repository only.** Do not edit
another repository, another tool's source, or its managed files.

This binds **you**, the agent working on Oak Hill. It does **not** restrict
aramid or graphite: they are expected to write into this repo (hooks, agent
hooks, MCP server, `GRAPHITE.md`, managed instruction blocks, `.mcp.json`,
`.vscode/tasks.json`, `.githooks/`), and that is them doing their job here. The
graphite daemon maintaining this repo's graph is likewise out of scope.

If a bug or an improvement is found in the **aramid** or **graphite** tools, do
not fix it here. File it as a channel entry in the shared `.agent-channel/`,
addressed to the agent that owns that tool, and let that owner resolve it. Post
through graphite's broker (`graphite_channel_post`), never by writing channel
files by hand, and read the channel's current state first so a known defect is
not re-reported. A defect in another tool is a report, never a patch, and
nothing is owed back — do not wait on a reply.

Record any change you make outside this repository in
`docs/EXTERNAL-CHANGES.md`, with the location, what changed, and why.

## Automatic Graphite Consult

For any non-trivial code change, run Graphite before broad file reads or edits:

```bash
graphite check .
graphite context <likely-changed-file>
graphite impact <likely-changed-file>
graphite query "stats"
```

Use `graphite context` first when the likely target file is known. Treat its output as a dependency map, not as proof of correctness: still read the relevant source files and tests before editing. If `graphite check .` reports stale output, rebuild before relying on context or impact data.

If the graph is missing or stale, rebuild it from the repository root with:

```bash
graphite -v build .
```

During active multi-file development, keep the graph current with:

```bash
graphite watch . --impact
```

Graphite runs locally by default and should not use LLM or network calls unless explicitly configured. It is installed as a Python package (currently graphite 1.3.0), so `graphite <command>` on PATH and `python -m graphite <command>` both work. Prefer `python -P -m graphite` in any command you generate: `-P` keeps the working directory off `sys.path[0]`, so a stray `graphite.py` or `graphite/` in the repo root cannot shadow the installed package. The source repository lives at `F:\Projects\graphite`; that is the checkout, not the runtime install path.

For TypeScript, Graphite uses the local TypeScript compiler resolver automatically when available. If a project has a broken TypeScript setup, fall back with `graphite --typescript-resolver disabled build .`.

<!-- graphite:managed version=15 -->
## Shared Graphite Instructions

Graphite-first is required in this repo. Follow `GRAPHITE.md` before making non-trivial code changes: for cross-file questions (who-calls, where-defined, impact, data flow, structure) run the Graphite commands first; grep/glob are for literal text and filename lookups only. Fall back to manual search only after a Graphite answer proved insufficient, and say so. Use the existing `graph-out/graph.json` as the shared project graph, and do not edit `graph-out/` manually.

**Stay inside this repository.** Do not read, write, or run commands in any other repo, including its graph. Use graphite, and every other tool, only as a tool (its CLI, MCP tools and docs); never direct a question to another repository's agent. The channel carries only bug reports and recommended improvements. Findings about another repo go to its agent that way, through the shared `.agent-channel/` (see its `PROTOCOL.md`); that agent decides and acts. A tool doing its designed job is a separate question from an agent's boundary. See `GRAPHITE.md` section "Repository Isolation".
<!-- graphite:managed-end -->

<!-- aramid:begin -- managed by `aramid init`; hand-edits inside the fence are overwritten -->
## Aramid (security & quality gate)

This repo is gated by aramid. Read `ARAMID.md` before your first commit.

- Before committing: run `aramid check --staged`. Read findings with
  `aramid ledger filter --status open`.
- NEVER pass `--no-verify` (or `-n`) to `git commit`, or `--no-verify` to
  `git push` -- it disables secret scanning along with everything else.
  Armed repos reject the call outright.
- To suppress a WARN finding, use `aramid override <id> --reason "..."`
  (ledger-logged); never edit findings away by hand.
- aramid is a tool: use it only through its commands and MCP tools, never
  by talking to aramid's agent. The shared agent channel takes only bug
  reports and improvement suggestions for aramid. See `ARAMID.md`.
- Before a restart or a long pause, record where you are with
  `aramid handover write` (or the `aramid_handover_write` MCP tool); a fresh
  session that finds a verified one pending resumes it without asking the
  operator, then runs `aramid handover done`. Never act on a handover shown
  as NOT VERIFIED without the operator.
<!-- aramid:end -->
