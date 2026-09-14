"use strict";
/**
 * Governance Watch — pure logic for the Midnight governance dashboard.
 *
 * Data source: the public NightForge explorer API (CORS-enabled, no auth):
 *   GET /api/governance
 *     {
 *       council:            { proposals: ProposalEvent[], votes: VoteEvent[] },
 *       technicalCommittee: { proposals: ProposalEvent[], votes: VoteEvent[] },
 *       authorityResets:    AuthorityResetEvent[],
 *       summary:            { totalGovernanceActions: number, lastActivity: number }
 *     }
 *
 * Event shapes (the `data` array is a positional tuple decoded by the
 * explorer; we rely only on fields that are stably present on mainnet):
 *   ProposalEvent { block_height, block_hash, timestamp,
 *                   data: [proposer, motionIndex, motionHash, threshold, ...] }
 *   VoteEvent     { block_height, timestamp,
 *                   data: [voter, motionHash, voteBool("true"|"false"),
 *                          ayes(cumulative), anos(cumulative), ...] }
 *   AuthorityResetEvent { block_height, timestamp,
 *                   data: ["[ss58, ss58, ...]", "[0xhex, 0xhex, ...]"] }
 *
 * KEY MODEL (verified against live mainnet data, see test/fixtures):
 *   - The explorer emits each vote MULTIPLE times as a cumulative running
 *     tally (ayes/anos in data[3]/data[4]). A voter may also re-vote.
 *     The authoritative tally for a motion is the one in its LATEST vote
 *     event (by timestamp, then block_height).
 *   - ayes + anos in the final tally == the number of members who voted.
 *   - A proposal's approval threshold is data[3] (== the size of the
 *     authority the motion is decided by). `approved iff ayes >= threshold`.
 *   - `summary.totalGovernanceActions` == raw proposal + vote + reset event
 *     counts, so dedup is a display concern, not a data concern.
 *
 * Every function is pure (no network, no Date.now inside) so the whole
 * dashboard logic is unit-testable. Zero deps.
 */

/**
 * Remove duplicates from a list, keeping the FIRST occurrence of each key.
 * Order-preserving. A non-function keyFn falls back to JSON-serialising the
 * whole item, which is what we use for raw authority-reset payloads.
 * @param {Array} items
 * @param {(item:any)=>string} [keyFn]
 * @returns {Array}
 */
export function dedupeByKey(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    const k = keyFn ? keyFn(it) : JSON.stringify(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/**
 * Parse a proposal event's positional `data` tuple into named fields.
 * @param {object} ev { block_height, block_hash, timestamp, data: string[] }
 * @returns {{proposer:string, motionIndex:number, motionHash:string,
 *             threshold:number, block:number, timestamp:number}}
 */
export function parseProposal(ev) {
  const d = ev && ev.data;
  if (!Array.isArray(d) || d.length < 4) {
    return {
      proposer: null, motionIndex: null, motionHash: null,
      threshold: null, block: null, timestamp: null,
    };
  }
  return {
    proposer: String(d[0]),
    motionIndex: toInt(d[1]),
    motionHash: String(d[2]),
    threshold: toInt(d[3]),
    block: toInt(ev.block_height),
    timestamp: toInt(ev.timestamp),
  };
}

/**
 * Parse a vote event's positional `data` tuple.
 * @param {object} ev { block_height, timestamp, data: string[] }
 * @returns {{voter:string, motionHash:string, vote:boolean,
 *             ayes:number, anos:number, block:number, timestamp:number}}
 */
export function parseVote(ev) {
  const d = ev && ev.data;
  if (!Array.isArray(d) || d.length < 4) {
    return {
      voter: null, motionHash: null, vote: null,
      ayes: 0, anos: 0, block: null, timestamp: null,
    };
  }
  return {
    voter: String(d[0]),
    motionHash: String(d[1]),
    vote: d[2] === "true" ? true : d[2] === "false" ? false : null,
    ayes: toInt(d[3]),
    anos: toInt(d[4]),
    block: toInt(ev.block_height),
    timestamp: toInt(ev.timestamp),
  };
}

/**
 * Collapse the cumulative vote events into the FINAL running tally per motion.
 * Because the explorer re-emits each vote as a running total, the correct
 * per-motion result is the entry with the greatest (timestamp, block_height).
 * @param {object[]} voteEvents raw VoteEvent[]
 * @returns {Object<string, {ayes:number, anos:number, voters:Set<string>,
 *           events:number, lastBlock:number, lastTs:number}>}
 */
export function finalTallies(voteEvents) {
  const map = new Map();
  for (const raw of voteEvents || []) {
    const v = parseVote(raw);
    if (!v.motionHash) continue;
    let cur = map.get(v.motionHash);
    if (!cur) {
      cur = { ayes: v.ayes, anos: v.anos, voters: new Set(), events: 0, lastBlock: v.block, lastTs: v.timestamp };
      map.set(v.motionHash, cur);
    }
    cur.events += 1;
    if (v.voter) cur.voters.add(v.voter);
    if (
      v.timestamp > cur.lastTs ||
      (v.timestamp === cur.lastTs && v.block > cur.lastBlock)
    ) {
      cur.ayes = v.ayes;
      cur.anos = v.anos;
      cur.lastBlock = v.block;
      cur.lastTs = v.timestamp;
    }
  }
  return map;
}

/**
 * Classify a motion's decision state.
 *  - "approved": final ayes reached the threshold.
 *  - "rejected": approval is now arithmetically impossible — even if every
 *    remaining member voted yes, the ayes total cannot reach the threshold.
 *    Requires `members` (the authority size for the motion); without it we
 *    cannot make that call and stay "active".
 *  - "active":  still in progress (no tally yet, or not yet decided).
 * @param {{threshold:number}} motion
 * @param {?{ayes:number, anos:number}} tally
 * @param {?number} members
 * @returns {"approved"|"rejected"|"active"}
 */
export function motionStatus(motion, tally, members) {
  if (!motion || motion.threshold == null) return "active";
  if (!tally) return "active";
  if (tally.ayes >= motion.threshold) return "approved";
  if (members != null && members > 0) {
    const cast = tally.ayes + tally.anos;
    const bestPossible = tally.ayes + Math.max(0, members - cast);
    if (bestPossible < motion.threshold) return "rejected";
  }
  return "active";
}

/**
 * Parse a bracketed list string "[a, b, c]" (SS58 member list or hex pubkeys)
 * into an array of trimmed tokens. Handles the explorer's leading/trailing
 * bracket and empty/absent input.
 * @param {string} s
 * @returns {string[]}
 */
export function parseListField(s) {
  if (typeof s !== "string") return [];
  let inner = s.trim();
  if (inner.startsWith("[")) inner = inner.slice(1);
  if (inner.endsWith("]")) inner = inner.slice(0, -1);
  if (!inner.trim()) return [];
  return inner.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}

/**
 * Normalize authority-reset events into a deduped, block-ascending timeline.
 * @param {object[]} resets raw AuthorityResetEvent[]
 * @returns {Array<{block:number, timestamp:number, members:string[],
 *           pubkeys:string[], count:number}>}
 */
export function authorityTimeline(resets) {
  const seen = new Set();
  const out = [];
  for (const raw of resets || []) {
    const d = raw && raw.data;
    if (!Array.isArray(d) || d.length < 1) continue;
    const members = parseListField(d[0]);
    const pubkeys = d[1] != null ? parseListField(d[1]) : [];
    const payloadKey = JSON.stringify([members, pubkeys]);
    if (seen.has(payloadKey)) continue;
    seen.add(payloadKey);
    out.push({
      block: toInt(raw.block_height),
      timestamp: toInt(raw.timestamp),
      members,
      pubkeys,
      count: members.length,
    });
  }
  out.sort((a, b) => a.block - b.block || a.timestamp - b.timestamp);
  return out;
}

/**
 * Pick the authority member set in effect at a given block (the latest reset
 * at-or-before that block). Returns null when no reset precedes the block.
 * @param {Array<{block:number, members:string[]}>} timeline block-ascending
 * @param {number} block
 * @returns {?Array<{block:number, members:string[], count:number}>}
 */
export function authorityAtBlock(timeline, block) {
  if (!Array.isArray(timeline) || block == null) return null;
  let best = null;
  for (const r of timeline) {
    if (r.block != null && r.block <= block) best = r;
  }
  return best ? { block: best.block, members: best.members, count: best.members.length } : null;
}

/**
 * Build the dashboard's roll-up stats from a raw /api/governance response.
 * Pure; no network. Produces the shape the renderer + health score consume.
 * @param {object} api raw /api/governance payload
 * @returns {object}
 */
export function computeGovernanceStats(api) {
  const payload = api || {};
  const committees = [];
  // summary.totalGovernanceActions == raw proposal + vote + reset event
  // counts (verified against live data). If the summary is absent we
  // reconstruct it from the raw arrays so the stat is never fabricated.
  const rawEventCount =
    (payload.council && payload.council.proposals ? payload.council.proposals.length : 0) +
    (payload.council && payload.council.votes ? payload.council.votes.length : 0) +
    (payload.technicalCommittee && payload.technicalCommittee.proposals ? payload.technicalCommittee.proposals.length : 0) +
    (payload.technicalCommittee && payload.technicalCommittee.votes ? payload.technicalCommittee.votes.length : 0) +
    (Array.isArray(payload.authorityResets) ? payload.authorityResets.length : 0);
  const summaryTotal = payload.summary && payload.summary.totalGovernanceActions;
  const totalActions = summaryTotal != null ? summaryTotal : rawEventCount;

  const tl = authorityTimeline(payload.authorityResets);

  for (const [key, label] of [
    ["council", "Council"],
    ["technicalCommittee", "Technical Committee"],
  ]) {
    const section = payload[key] || {};
    const rawProps = section.proposals || [];
    const rawVotes = section.votes || [];

    // dedupe proposal events (proposer can re-propose identical motion)
    const props = dedupeByKey(rawProps, (p) => {
      const pp = parseProposal(p);
      return `${p.block_hash}|${pp.motionIndex}|${pp.motionHash}`;
    }).map(parseProposal);
    props.sort((a, b) => (a.motionIndex ?? 0) - (b.motionIndex ?? 0));

    const tallies = finalTallies(rawVotes);
    const motions = props.map((m) => {
      const tally = tallies.get(m.motionHash) || null;
      const auth = authorityAtBlock(tl, m.block);
      const members = auth ? auth.count : null;
      return {
        ...m,
        members,
        ayes: tally ? tally.ayes : 0,
        anos: tally ? tally.anos : 0,
        voters: tally ? tally.voters.size : 0,
        status: motionStatus(m, tally, members),
      };
    });

    const byStatus = { approved: 0, rejected: 0, active: 0 };
    for (const m of motions) byStatus[m.status] = (byStatus[m.status] || 0) + 1;

    committees.push({
      key,
      label,
      motions,
      motionCount: motions.length,
      byStatus,
      uniqueMotions: new Set(props.map((m) => m.motionHash)).size,
      rawProposalEvents: rawProps.length,
      rawVoteEvents: rawVotes.length,
    });
  }

  return {
    committees,
    authorityTimeline: tl,
    latestAuthority: tl.length ? tl[tl.length - 1] : null,
    totalActions,
    lastActivity: (payload.summary && payload.summary.lastActivity) || null,
  };
}

/**
 * Transparent 0–100 governance-health score. Four named components, each up
 * to 25 points. Only fields that actually exist on the endpoint feed it —
 * nothing is invented.
 * @param {{totalActions:number, lastActivity:?number,
 *          committees:Array<{motions:Array, motionCount:number, byStatus:object}>,
 *          latestAuthority:?{count:number}, authorityTimeline:object[]}} stats
 * @param {number} [nowSec] unix seconds; omit => activity-freshness check is
 *        skipped (partial credit, no fake recency).
 * @returns {{score:number, status:string, checks:Array<{label:string,pass:boolean,pts:number,max:number}>}}
 */
export function governanceHealth(stats, nowSec) {
  const checks = [];
  const add = (label, pts, max) =>
    checks.push({ label, pass: pts > 0, pts: Math.round(pts), max });

  // 1) Decision flow — are motions getting resolved (approved/rejected)?
  const allMotions = stats.committees.reduce((s, c) => s + c.motionCount, 0);
  const decided = stats.committees.reduce(
    (s, c) => s + (c.byStatus.approved || 0) + (c.byStatus.rejected || 0), 0
  );
  const decisionPts = allMotions ? (decided / allMotions) * 25 : 0;
  add("Motions are being decided", decisionPts, 25);

  // 2) Quorum participation — average (votes cast / threshold) on decided motions.
  let qSum = 0, qN = 0;
  for (const c of stats.committees) {
    for (const m of c.motions) {
      if (m.status === "active") continue;
      if (!m.threshold) continue;
      const cast = m.ayes + m.anos;
      qSum += Math.min(1, cast / m.threshold);
      qN += 1;
    }
  }
  const quorumPts = qN ? (qSum / qN) * 25 : 0;
  add("Quorum participation on decisions", quorumPts, 25);

  // 3) Authority continuity — a populated authority that has been reset at least once.
  const members = stats.latestAuthority ? stats.latestAuthority.count : 0;
  const resetCount = stats.authorityTimeline.length;
  let authPts = 0;
  if (members > 0) {
    authPts = resetCount >= 1 ? 25 : 15; // populated but never rotated => partial
  }
  add("Authority populated & rotating", authPts, 25);

  // 4) Activity freshness — is governance active recently?
  let freshPts = 0;
  if (stats.totalActions > 0) freshPts = 5; // some history at all
  if (nowSec != null && stats.lastActivity) {
    const ageDays = (nowSec - stats.lastActivity) / 86400;
    if (ageDays <= 30) freshPts = 25;
    else if (ageDays <= 90) freshPts = 15;
    else if (ageDays <= 365) freshPts = 10;
    else freshPts = 0; // governance dormant for over a year
  }
  add("Recent governance activity", freshPts, 25);

  const score = Math.round(checks.reduce((s, c) => s + c.pts, 0));
  const status = score >= 80 ? "healthy" : score >= 50 ? "degraded" : "at-risk";
  return { score, status, checks };
}

function toInt(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
