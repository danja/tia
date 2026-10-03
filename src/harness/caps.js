/**
 * Process-local OCap-style capabilities for TIA tool calls.
 * Authority is a handle, not a role name. Attenuation only (child ⊆ parent).
 * Does NOT replace human authorization — pair with authority-gate.js.
 */

import { randomBytes } from "node:crypto";

/** @typedef {{
 *   id: string,
 *   resource: string,
 *   actions: Set<string>,
 *   constraints: Record<string, unknown>,
 *   taskId: string,
 *   expiresAt: string,
 *   parentId: string | null
 * }} Cap */

const store = new Map();

function now() {
  return Date.now();
}

/**
 * @param {object} opts
 * @param {string} opts.resource
 * @param {string[]} opts.actions
 * @param {Record<string, unknown>} [opts.constraints]
 * @param {string} opts.taskId
 * @param {number} opts.ttlSeconds
 * @param {Cap | null} [opts.parent]
 * @returns {Cap}
 */
export function issue({
  resource,
  actions,
  constraints = {},
  taskId,
  ttlSeconds,
  parent = null
}) {
  const actionSet = new Set(actions);
  if (parent) {
    for (const a of actionSet) {
      if (!parent.actions.has(a)) {
        throw new Error(`attenuation violated: action "${a}" not in parent`);
      }
    }
    if (resource !== parent.resource && !resource.startsWith(parent.resource + ":")) {
      throw new Error(
        `attenuation violated: resource "${resource}" not under parent "${parent.resource}"`
      );
    }
    if (parent.taskId !== taskId) {
      throw new Error("attenuation violated: taskId must match parent");
    }
  }
  const expiresAt = new Date(now() + ttlSeconds * 1000).toISOString();
  /** @type {Cap} */
  const cap = {
    id: randomBytes(16).toString("base64url"),
    resource,
    actions: actionSet,
    constraints: { ...constraints },
    taskId,
    expiresAt,
    parentId: parent ? parent.id : null
  };
  store.set(cap.id, cap);
  return cap;
}

/**
 * @param {string} capId
 * @param {string} resource
 * @param {string} action
 * @param {string} taskId
 */
export function check(capId, resource, action, taskId) {
  const cap = store.get(capId);
  if (!cap) return false;
  if (cap.taskId !== taskId) return false;
  if (Date.parse(cap.expiresAt) <= now()) return false;
  if (cap.resource !== resource) return false;
  if (!cap.actions.has(action)) return false;
  return true;
}

export function get(capId) {
  return store.get(capId) || null;
}

export function clearCaps() {
  store.clear();
}

export function listCapIds() {
  return [...store.keys()];
}
