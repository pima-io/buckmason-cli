export const VOTE_POST_FUNCTION = String.raw`// POST /api/vote - routes one browser ballot to the per-lookbook Durable Object.
//
// The Durable Object owns validation, persistence, tallying, and WebSocket fanout.
// Keeping writes serialized there avoids read-modify-write races and avoids
// rebuilding tallies by scanning KV on every request.
export async function onRequestPost({ request, env }) {
  if (!env.VOTE_ROOM || !env.LOOKBOOK_ID) {
    return json({ ok: false, error: "VOTE_ROOM binding missing" }, 503);
  }

  const body = await request.text();
  const room = voteRoom(env);
  const response = await room.fetch("https://vote-room.internal/vote", {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") || "application/json",
      "user-agent": request.headers.get("user-agent") || "",
      "x-voter-ip": request.headers.get("CF-Connecting-IP") || "",
    },
    body,
  });
  return withCors(response);
}

function voteRoom(env) {
  const id = env.VOTE_ROOM.idFromName(env.LOOKBOOK_ID || "unknown");
  return env.VOTE_ROOM.get(id);
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  return new Response(response.body, { status: response.status, headers });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
`

export const VOTES_GET_FUNCTION = String.raw`// GET /api/votes - returns the public-safe tally from the per-lookbook Durable Object.
//
// The edge cache still absorbs passive viewer polling, but the origin tally no
// longer scans one KV key per ballot. The Durable Object keeps a short in-memory
// tally cache and computes from local SQLite rows.
export async function onRequestGet({ request, env }) {
  if (!env.VOTE_ROOM || !env.LOOKBOOK_ID) {
    return json({ ok: false, error: "VOTE_ROOM binding missing" }, 503);
  }

  const url = new URL(request.url);
  const cacheable = url.searchParams.get("fresh") !== "1";
  const cacheKey = new Request(url.origin + url.pathname + "?lookbook=" + encodeURIComponent(env.LOOKBOOK_ID || "unknown"));

  if (cacheable && typeof caches !== "undefined") {
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached;
  }

  const response = await voteRoom(env).fetch("https://vote-room.internal/tally", {
    headers: { accept: "application/json" },
  });
  const withHeaders = withCors(response);

  if (cacheable && withHeaders.ok && typeof caches !== "undefined") {
    try { await caches.default.put(cacheKey, withHeaders.clone()); } catch {}
  }

  return withHeaders;
}

function voteRoom(env) {
  const id = env.VOTE_ROOM.idFromName(env.LOOKBOOK_ID || "unknown");
  return env.VOTE_ROOM.get(id);
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("cache-control", "public, max-age=2, s-maxage=2, stale-while-revalidate=8");
  return new Response(response.body, { status: response.status, headers });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
`

export const VOTES_LIVE_FUNCTION = String.raw`// GET /api/votes/live - WebSocket upgrade endpoint for real-time tally fanout.
//
// The Durable Object stores the tally and accepts the WebSocket server side.
export async function onRequestGet({ request, env }) {
  if (!env.VOTE_ROOM || !env.LOOKBOOK_ID) {
    return json({ ok: false, error: "VOTE_ROOM binding missing" }, 503);
  }
  const upgrade = request.headers.get("Upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", {
      status: 426,
      headers: { "content-type": "text/plain", "upgrade": "websocket" },
    });
  }

  const id = env.VOTE_ROOM.idFromName(env.LOOKBOOK_ID);
  return env.VOTE_ROOM.get(id).fetch(request);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
`

export const VOTE_ROOM_WORKER = String.raw`// Durable Object vote room for Cloudflare Pages lookbooks.
//
// This object is the single writer for one lookbook. Ballots live in local
// SQLite-backed Durable Object storage; KV is used only as a one-time legacy
// import source for lookbooks deployed before the SQLite tally path.
export class VoteRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.schemaReady = false;
    this.legacyImportPromise = null;
    this.cachedText = null;
    this.cachedAt = 0;
    this.broadcastTimer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const upgrade = request.headers.get("Upgrade") || "";
    await this.ensureReady();

    if (upgrade.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      this.sendTally(server, false).catch(() => {});
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "POST" && url.pathname.endsWith("/vote")) {
      return json(await this.upsertFromRequest(request));
    }

    if (request.method === "GET" && url.pathname.endsWith("/tally")) {
      return new Response(await this.tallyText(false), {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=2, s-maxage=2, stale-while-revalidate=8",
        },
      });
    }

    // Compatibility with old Pages Functions that wrote KV directly and then
    // pinged /broadcast. New deployments call /vote instead.
    if (request.method === "POST" && url.pathname.endsWith("/broadcast")) {
      await this.ensureLegacyImported(true);
      this.scheduleBroadcast();
      return json({ ok: true, queued: true });
    }

    return json({ ok: false, error: "not found" }, 404);
  }

  async webSocketMessage(ws, message) {
    if (String(message || "").toLowerCase() === "ping") {
      ws.send(JSON.stringify({ type: "pong", ts: new Date().toISOString() }));
      return;
    }
    if (String(message || "").toLowerCase() === "refresh") {
      await this.sendTally(ws, false);
    }
  }

  webSocketClose() {}
  webSocketError() {}

  async upsertFromRequest(request) {
    let body;
    try { body = await request.json(); }
    catch { return { ok: false, error: "invalid json" }; }

    const record = normalizeBallot(body, request.headers, this.lookbookId());
    const hasVoterText = Boolean(String(body.voter || "").trim() || String(body.comment || "").trim());
    if (!hasVotes(record) && !hasVoterText) {
      return { ok: false, error: "empty ballot" };
    }

    this.upsertBallot(record);
    this.cachedText = null;
    this.scheduleBroadcast();

    return {
      ok: true,
      key: voteKey(record.lookbook_id, record.ballot_id),
      ts: record.ts,
      ballot_id: record.ballot_id,
    };
  }

  upsertBallot(record) {
    this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      sql.exec(
        "INSERT OR REPLACE INTO ballots (ballot_id, voter, comment, ts, ip, ua, lookbook_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        record.ballot_id,
        record.voter,
        record.comment,
        record.ts,
        record.ip,
        record.ua,
        record.lookbook_id,
      );
      sql.exec("DELETE FROM votes WHERE ballot_id = ?", record.ballot_id);
      for (const [look, vote] of Object.entries(record.looks || {})) {
        sql.exec(
          "INSERT INTO votes (ballot_id, kind, target_id, vote) VALUES (?, 'look', ?, ?)",
          record.ballot_id,
          look,
          vote,
        );
      }
      for (const [sku, vote] of Object.entries(record.items || {})) {
        sql.exec(
          "INSERT INTO votes (ballot_id, kind, target_id, vote) VALUES (?, 'item', ?, ?)",
          record.ballot_id,
          sku,
          vote,
        );
      }
    });
  }

  async sendTally(socket, force) {
    socket.send(await this.tallyText(force));
  }

  async broadcastTally(force) {
    const text = await this.tallyText(force);
    let sent = 0;
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(text);
        sent += 1;
      } catch {}
    }
    return sent;
  }

  scheduleBroadcast() {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.broadcastTally(true).catch(() => {});
    }, 500);
  }

  async tallyText(force) {
    const now = Date.now();
    if (!force && this.cachedText && now - this.cachedAt < 1000) return this.cachedText;
    const tally = this.buildTally();
    this.cachedText = JSON.stringify({
      type: "tally",
      ok: true,
      tally,
      votes: tally.voters,
    });
    this.cachedAt = now;
    return this.cachedText;
  }

  buildTally() {
    const tally = {
      count: 0,
      last_vote_ts: null,
      generated_at: new Date().toISOString(),
      looks: {},
      items: {},
      voters: [],
      recent: [],
      activity: this.activityBuckets(),
    };

    const meta = firstRow(this.ctx.storage.sql.exec(
      "SELECT COUNT(DISTINCT b.ballot_id) AS count, MAX(b.ts) AS last_vote_ts FROM ballots b JOIN votes v ON v.ballot_id = b.ballot_id",
    ));
    tally.count = Number(meta?.count || 0);
    tally.last_vote_ts = meta?.last_vote_ts || null;

    for (const row of this.ctx.storage.sql.exec(
      "SELECT kind, target_id, vote, COUNT(*) AS count FROM votes GROUP BY kind, target_id, vote",
    )) {
      const map = row.kind === "look" ? tally.looks : tally.items;
      const bucket = targetBucket(map, row.target_id);
      const count = Number(row.count || 0);
      if (row.vote === "up") bucket.up = count;
      if (row.vote === "down") bucket.down = count;
      finishBucket(bucket);
    }

    const detailSeen = new Map();
    for (const row of this.ctx.storage.sql.exec(
      "SELECT v.kind, v.target_id, v.vote, b.voter, b.comment, b.ts FROM votes v JOIN ballots b ON b.ballot_id = v.ballot_id ORDER BY b.ts DESC",
    )) {
      const key = row.kind + ":" + row.target_id + ":" + row.vote;
      const seen = detailSeen.get(key) || 0;
      if (seen >= 24) continue;
      detailSeen.set(key, seen + 1);

      const map = row.kind === "look" ? tally.looks : tally.items;
      const bucket = targetBucket(map, row.target_id);
      const list = row.vote === "up" ? bucket.up_voters : bucket.down_voters;
      list.push({ voter: displayName(row.voter), comment: displayComment(row.comment), ts: row.ts });
    }

    for (const row of this.ctx.storage.sql.exec(
      "SELECT b.ballot_id, b.voter, b.comment, b.ts FROM ballots b WHERE TRIM(COALESCE(b.comment, '')) <> '' AND EXISTS (SELECT 1 FROM votes v WHERE v.ballot_id = b.ballot_id) ORDER BY b.ts DESC LIMIT 8",
    )) {
      tally.recent.push({ voter: row.voter, ts: row.ts, comment: row.comment, looks: {}, items: {} });
    }

    for (const row of this.ctx.storage.sql.exec(
      "SELECT b.ballot_id, b.voter, b.comment, b.ts FROM ballots b WHERE EXISTS (SELECT 1 FROM votes v WHERE v.ballot_id = b.ballot_id) ORDER BY b.ts DESC LIMIT 100",
    )) {
      tally.voters.push({ voter: row.voter, ts: row.ts, comment: row.comment, looks: {}, items: {} });
    }

    return tally;
  }

  activityBuckets() {
    const now = Date.now();
    const buckets = [];
    for (let i = 4; i >= 0; i--) {
      const startMs = now - (i + 1) * 60_000;
      const endMs = now - i * 60_000;
      const row = firstRow(this.ctx.storage.sql.exec(
        "SELECT COUNT(DISTINCT b.ballot_id) AS count FROM ballots b JOIN votes v ON v.ballot_id = b.ballot_id WHERE b.ts >= ? AND b.ts < ?",
        new Date(startMs).toISOString(),
        new Date(endMs).toISOString(),
      ));
      buckets.push({ start: new Date(startMs).toISOString(), count: Number(row?.count || 0) });
    }
    return buckets;
  }

  async ensureReady() {
    this.ensureSchema();
    await this.ensureLegacyImported(false);
  }

  ensureSchema() {
    if (this.schemaReady) return;
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS ballots (ballot_id TEXT PRIMARY KEY, voter TEXT NOT NULL, comment TEXT NOT NULL, ts TEXT NOT NULL, ip TEXT, ua TEXT, lookbook_id TEXT NOT NULL)");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS votes (ballot_id TEXT NOT NULL, kind TEXT NOT NULL, target_id TEXT NOT NULL, vote TEXT NOT NULL, PRIMARY KEY (ballot_id, kind, target_id))");
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS votes_target_idx ON votes (kind, target_id, vote)");
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS votes_ballot_idx ON votes (ballot_id)");
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS ballots_ts_idx ON ballots (ts DESC)");
    this.schemaReady = true;
  }

  async ensureLegacyImported(force) {
    if (this.legacyImportPromise) return this.legacyImportPromise;
    const imported = firstRow(this.ctx.storage.sql.exec("SELECT value FROM meta WHERE key = 'legacy_kv_imported'"));
    if (imported && !force) return;

    this.legacyImportPromise = this.importLegacyKv(force).finally(() => {
      this.legacyImportPromise = null;
    });
    return this.legacyImportPromise;
  }

  async importLegacyKv(force) {
    if (!this.env.LOOKBOOK_VOTES) {
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_kv_imported', ?)", new Date().toISOString());
      return;
    }

    const lookbookId = this.lookbookId();
    const prefix = "vote:" + lookbookId + ":ballot:";
    let cursor;
    let imported = 0;
    while (true) {
      const opts = { prefix };
      if (cursor) opts.cursor = cursor;
      const list = await this.env.LOOKBOOK_VOTES.list(opts);
      for (const key of list.keys || []) {
        const value = await this.env.LOOKBOOK_VOTES.get(key.name);
        if (!value) continue;
        try {
          const parsed = JSON.parse(value);
          const record = normalizeStoredBallot(parsed, lookbookId);
          if (hasVotes(record)) {
            this.upsertBallot(record);
            imported += 1;
          }
        } catch {}
      }
      if (list.list_complete || !list.cursor) break;
      cursor = list.cursor;
    }

    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_kv_imported', ?)", new Date().toISOString());
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_kv_imported_count', ?)", String(imported));
    this.cachedText = null;
  }

  lookbookId() {
    return this.env.LOOKBOOK_ID || "unknown";
  }
}

export default {
  fetch() {
    return json({ ok: true, service: "buckmason-vote-room" });
  },
};

function normalizeBallot(body, headers, lookbookId) {
  const rawBallotId = String(body.ballot_id || "").slice(0, 96);
  const ballot_id = /^[A-Za-z0-9_-]{12,96}$/.test(rawBallotId)
    ? rawBallotId
    : crypto.randomUUID();
  return {
    ballot_id,
    voter: displayName(body.voter),
    comment: String(body.comment || "").slice(0, 1000),
    looks: collectVotes(body.looks, /^look[0-9]+$/, 64),
    items: collectVotes(body.items, /^.+$/, 64),
    ts: new Date().toISOString(),
    ip: headers.get("x-voter-ip") || null,
    ua: (headers.get("user-agent") || "").slice(0, 200),
    lookbook_id: lookbookId,
  };
}

function normalizeStoredBallot(body, lookbookId) {
  const rawBallotId = String(body.ballot_id || "").slice(0, 96);
  return {
    ballot_id: /^[A-Za-z0-9_-]{12,96}$/.test(rawBallotId)
      ? rawBallotId
      : crypto.randomUUID(),
    voter: displayName(body.voter),
    comment: String(body.comment || "").slice(0, 1000),
    looks: collectVotes(body.looks, /^look[0-9]+$/, 64),
    items: collectVotes(body.items, /^.+$/, 64),
    ts: body.ts || new Date().toISOString(),
    ip: body.ip || null,
    ua: String(body.ua || "").slice(0, 200),
    lookbook_id: body.lookbook_id || lookbookId,
  };
}

function collectVotes(source, keyPattern, maxKeyLength) {
  const out = {};
  for (const [key, value] of Object.entries(source || {})) {
    const target = String(key).slice(0, maxKeyLength);
    if (target && keyPattern.test(target) && (value === "up" || value === "down")) {
      out[target] = value;
    }
  }
  return out;
}

function hasVotes(record) {
  return Object.keys(record.looks || {}).length > 0 || Object.keys(record.items || {}).length > 0;
}

function voteKey(lookbookId, ballotId) {
  return "vote:" + lookbookId + ":ballot:" + ballotId;
}

function targetBucket(map, targetId) {
  return map[targetId] ||= { up: 0, down: 0, total: 0, score: 0, up_voters: [], down_voters: [] };
}

function finishBucket(bucket) {
  bucket.total = Number(bucket.up || 0) + Number(bucket.down || 0);
  bucket.score = Number(bucket.up || 0) - Number(bucket.down || 0);
  return bucket;
}

function firstRow(cursor) {
  for (const row of cursor) return row;
  return null;
}

function displayName(value) {
  return String(value || "anonymous").trim().slice(0, 60) || "anonymous";
}

function displayComment(value) {
  return String(value || "").trim().slice(0, 240);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
`
