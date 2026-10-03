/**
 * Hybrid authorization check (Node mirror of hivemind channel semantics).
 *
 * Gate may open on count / Queen elsewhere; the seal that may become Act requires:
 *   - outcome AUTHORIZED
 *   - authorized_by: non-empty named human
 *   - what_was_seen: non-empty object
 *   - proposal_hash match
 *   - ttl future
 *   - not yet spent (process-local)
 *
 * Compatible in spirit with https://github.com/miigwech-potato/hivemind channel.py
 * Does not claim cryptographic sender authenticity.
 */

const spent = new Set();

/**
 * @param {object | null | undefined} decision
 * @param {string} expectedProposalHash
 * @returns {boolean}
 */
export function mayAct(decision, expectedProposalHash) {
  if (!decision || typeof decision !== "object") return false;
  if (decision.kind && decision.kind !== "DECISION") return false;
  const payload = decision.payload || decision;
  if (payload.outcome !== "AUTHORIZED") return false;
  if (payload.proposal_hash !== expectedProposalHash) return false;

  const by = payload.authorized_by;
  if (typeof by !== "string" || !by.trim()) return false;

  const seen = payload.what_was_seen;
  if (!seen || typeof seen !== "object" || Array.isArray(seen) || Object.keys(seen).length === 0) {
    return false;
  }

  const ttl = decision.ttl ?? payload.ttl;
  if (ttl == null || ttl === "") return false;
  const ttlMs = Date.parse(ttl);
  if (Number.isNaN(ttlMs) || ttlMs <= Date.now()) return false;

  if (spent.has(expectedProposalHash)) return false;
  return true;
}

/**
 * Spend after a successful mayAct. Call only at the point of external action.
 * @param {object} decision
 * @param {string} expectedProposalHash
 */
export function consume(decision, expectedProposalHash) {
  if (!mayAct(decision, expectedProposalHash)) return false;
  if (spent.has(expectedProposalHash)) return false;
  spent.add(expectedProposalHash);
  return true;
}

export function clearSpent() {
  spent.clear();
}
