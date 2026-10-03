/**
 * Dual gate for TIA MCP tool calls:
 *   1) OCap-style capability handle (least privilege, task-bound)
 *   2) Hybrid human authorization record (authorized_by + what_was_seen)
 *
 * Either failure → no side effect (hold).
 * A capability never substitutes for the human record.
 */

import { check as checkCap } from "./caps.js";
import { mayAct, consume } from "./hybrid.js";

/**
 * @param {object} opts
 * @param {string} opts.toolName
 * @param {string} opts.capId
 * @param {string} opts.taskId
 * @param {string} opts.proposalHash
 * @param {object} opts.decision  hybrid AUTHORIZED-shaped object
 * @param {() => Promise<unknown>} opts.execute  actual tool side effect
 * @returns {Promise<{ status: 'ok'|'hold', reason?: string, result?: unknown }>}
 */
export async function invokeWithDualGate({
  toolName,
  capId,
  taskId,
  proposalHash,
  decision,
  execute
}) {
  const resource = `tool:${toolName}`;

  if (!checkCap(capId, resource, "invoke", taskId)) {
    return { status: "hold", reason: "no capability for tool/task (or expired)" };
  }
  if (!mayAct(decision, proposalHash)) {
    return {
      status: "hold",
      reason:
        "no hybrid AUTHORIZED (need authorized_by + non-empty what_was_seen + future ttl + unspent)"
    };
  }
  if (!consume(decision, proposalHash)) {
    return { status: "hold", reason: "approval already spent or race" };
  }

  const result = await execute();
  return { status: "ok", result };
}

/**
 * Wrap an McpClientBridge so callTool requires dual gate metadata.
 * Opt-in: only used when harness calls gatedCallTool / createGatedBridge.
 *
 * @param {import('../mcp/client-bridge.js').McpClientBridge} bridge
 * @param {() => { capId: string, taskId: string, proposalHash: string, decision: object }} getAuthContext
 */
export function createGatedBridge(bridge, getAuthContext) {
  return {
    bridge,
    async callTool(name, args = {}) {
      const ctx = getAuthContext(name, args);
      if (!ctx) {
        return {
          content: [{ type: "text", text: "HOLD: missing auth context" }],
          isError: true,
          _tiaHold: true,
          reason: "missing auth context"
        };
      }
      const gated = await invokeWithDualGate({
        toolName: name,
        capId: ctx.capId,
        taskId: ctx.taskId,
        proposalHash: ctx.proposalHash,
        decision: ctx.decision,
        execute: () => bridge.callTool(name, args)
      });
      if (gated.status === "hold") {
        return {
          content: [{ type: "text", text: `HOLD: ${gated.reason}` }],
          isError: true,
          _tiaHold: true,
          reason: gated.reason
        };
      }
      return gated.result;
    },
    listTools: (...a) => bridge.listTools(...a),
    close: (...a) => bridge.close(...a),
    connect: (...a) => bridge.connect(...a)
  };
}
