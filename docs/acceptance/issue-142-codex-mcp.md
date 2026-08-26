# Issue #142 — Loom MCP / Codex acceptance record

This record separates repository checks from the external Codex proof required by
#142. It must not be read as evidence that a local function import is equivalent
to a Codex MCP call.

## Scope and safety boundary

- The server is `node mcp/server.mjs` and uses newline-delimited JSON-RPC over
  stdio.
- The project-scoped Codex configuration is `.codex/config.toml`; it starts the
  server with `cwd = "."` and `LOOM_PROJECT_ROOT = "."`.
- Diagram paths are relative logical paths below the configured project root.
  The server and existing Diagram service reject absolute paths and traversal.
- The MCP boundary rejects absolute local path values and credential-shaped
  fields in request/response payloads. Error text redacts local paths and token
  assignments before it can reach stdout or stderr.
- The server has no HTTP listener and no credential or token configuration.
  Authorization for this local stdio connection is therefore process launch
  permission plus Codex's project trust/approval policy; no MCP OAuth flow is
  claimed.
- The server implements only `initialize`, `tools/list`, and `tools/call` for
  this issue. It does not implement semantic stream events, progress frames, or
  the #143 contract.

## Tool registration

`tools/list` exposes the existing tool services through the MCP boundary:

- Diagram: `diagram.create`, `diagram.open`, `diagram.validate`,
  `diagram.save`, `diagram.summary`.
- Component: `component.query`, `component.get`.
- Semantic transaction: `semantic.transaction.begin`,
  `semantic.transaction.preview`, `semantic.transaction.commit`,
  `semantic.transaction.cancel`, `semantic.transaction.fail`.

`tools/call` converts standard MCP arguments into the existing Loom tool
envelope and returns that validated result both as `structuredContent` and as a
serialized text content block. Semantic transaction commits are intentionally
memory-only; the result tells Codex to call `diagram.save` when persistence is
intended.

## Provider / transport / authorization evidence

| Field | Evidence | Status |
| --- | --- | --- |
| Provider | Real client: Codex CLI `codex-cli 0.147.0`; the CLI JSONL events expose the `loom` MCP server but do not expose an upstream provider/model field, so no stronger provider claim is made | Client/provider evidence recorded below; upstream provider/model remains unreported by this CLI event format |
| Transport | Project-scoped Codex config launches `node mcp/server.mjs` as a local child over stdio; the real JSONL contains `item.type=mcp_tool_call` with `server=loom` | Confirmed by the real discovery and summary call below |
| Authorization | No bearer token, OAuth, or credential is configured for Loom; CLI reports stdio auth as unsupported and the project policy keeps default tool approval at `writes` | Confirmed for the local boundary; write-capable calls still require approval |
| Transcript | Real Codex natural-language requests show tool discovery and actual `loom` MCP calls; the captured evidence is summarized from CLI JSONL, not synthesized | Discovery/read call confirmed; create attempt was cancelled by the approval gate |

## Real Codex transcript

<!-- Replace this section only with output captured from an actual Codex run.
     Redact absolute paths, tokens, credentials, and unrelated conversation
     content. A unit test or direct Node import is not a transcript. -->

Status: `PARTIAL_REAL_CODEX_RUN`

Observed evidence from two real `codex exec --json` runs (2026-08-26):

1. The first run emitted a real `mcp_tool_call` item with `server: "loom"`,
   `tool: "diagram.summary"`, and the relative path
   `examples/flovvas-massing.diagram.json`. Its completed result was the Loom
   tool envelope with `status: "ok"`, revision
   `sha256:e208422b39d7f1491a7304108a2dcf0d233c733366add85ae927cf8a39e09486`,
   and effects `kind: read`, `changed: false`, `reversible: true`.
2. The second run emitted real `diagram.open` MCP calls and then a real
   `diagram.create` MCP call with the returned Artifact, `dryRun: true`, and no
   output path. Codex reported the MCP call as cancelled by the user approval
   gate because `diagram.create` is correctly non-read-only. No create result,
   revision, or effects were invented or recorded.
3. The JSONL also contained Codex `thread.started`, `turn.started`,
   `item.completed`, and `turn.completed` events. The saved evidence contains
   no absolute local path, token, or credential. Raw event output is not
   committed because it includes large Artifact content and may contain
   environment metadata.
4. Codex CLI's JSONL stream exposes the model-visible MCP tool calls, not the
   underlying initialize/tools/list handshake frames. The subprocess test
   records that wire-level lifecycle; the real Codex evidence records that
   Codex selected the discovered `loom` tool and completed the actual call.
5. The real runs used the normal CLI configuration path. `--strict-config` is
   currently unavailable in this environment because an unrelated existing
   user configuration field is not recognized by this CLI version; regular
   execution still parsed the project-scoped Loom server and completed the
   MCP read call. A pre-existing models-cache warning did not prevent the call.

## Automated checks completed

- `node --check mcp/server.mjs`
- `node --test tests/mcp-server.test.mjs`
- `node scripts/loom-healthcheck.mjs`
- `node --test`
- Real Codex CLI discovery/read call through the project-scoped `loom` MCP
  server; the create attempt was blocked by the approval gate as recorded above.

## Manual/external checks still required

- Approve and rerun the natural-language `diagram.create` journey if Issue #142
  requires a successful creation result rather than the confirmed read call.
- Confirm the approved live transcript contains a successful create result with
  `status`, `revision`, and `effects`; the current attempt has only a cancelled
  create call.
- If a full creation journey is required by the parent acceptance gate, verify
  the returned Artifact opens in Workspace and keep that external evidence
  separate from repository tests.

Refs #142
