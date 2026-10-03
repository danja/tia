# TIA Authority Gate (optional harness)

**Opt-in** dual gate for MCP tool calls. Default TIA behavior is unchanged until you wrap a bridge.

## Rules

1. **Capability (OCap-style)** — Worker holds an unforgeable handle for `tool:<name>` + task. No ambient tool rights. Attenuation only (child ⊆ parent).
2. **Hybrid human record** — Same semantics as [hivemind](https://github.com/miigwech-potato/hivemind): Act requires `AUTHORIZED` with non-empty `authorized_by` and `what_was_seen`, future `ttl`, and single-use `proposal_hash` (process-local spent set).
3. **Order** — Check capability → `mayAct` → `consume` → execute. Either failure → HOLD, no side effect.
4. **A capability never replaces the human record.**

## Usage

```js
import { issue, invokeWithDualGate } from "./index.js";

const taskId = "task-42";
const proposalHash = "prop-abc";
const cap = issue({
  resource: "tool:echo",
  actions: ["invoke"],
  taskId,
  ttlSeconds: 300
});

const decision = {
  kind: "DECISION",
  ttl: new Date(Date.now() + 3600_000).toISOString(),
  payload: {
    proposal_hash: proposalHash,
    outcome: "AUTHORIZED",
    authorized_by: "human-owner",
    what_was_seen: { summary: "approved echo for demo" }
  }
};

const result = await invokeWithDualGate({
  toolName: "echo",
  capId: cap.id,
  taskId,
  proposalHash,
  decision,
  execute: () => bridge.callTool("echo", { message: "hi" })
});
// result.status === 'ok' | 'hold'
```

## Tests

```bash
node --test test/authority-gate.test.js
```

## Non-goals

- Cryptographic Gate signatures
- Durable cross-process spent store (harness duty if multi-node)
- Treating XMPP/Lingue agreement as authorization

Speech is not permission. Capability is not authority.
