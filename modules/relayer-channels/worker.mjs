export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- CORS preflight ---
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request.headers.get("Origin")) });
    }

    // --- Issue mainnet key ---
    if (url.pathname === "/gen" && request.method === "GET") {
      const rawKey  = crypto.randomUUID();
      const keyHash = await sha256Hex(`${env.KEY_SALT || ""}:${rawKey}`);
      const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "0.0.0.0";

      await env.API_KEYS.put(
        `key:${keyHash}`,
        JSON.stringify({ createdAt: Date.now(), ip, active: true, scope: "mainnet" }),
        { expirationTtl: 60 * 60 * 24 * 365 }
      );

      return json({ apiKey: rawKey }, {
        status: 201,
        headers: { "cache-control": "no-store", ...cors(request.headers.get("Origin")) }
      });
    }

    // --- Issue testnet key ---
    if (url.pathname === "/testnet/gen" && request.method === "GET") {
      const rawKey  = crypto.randomUUID();
      const keyHash = await sha256Hex(`${env.KEY_SALT || ""}:${rawKey}`);
      const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "0.0.0.0";

      await env.API_KEYS.put(
        `key:${keyHash}`,
        JSON.stringify({ createdAt: Date.now(), ip, active: true, scope: "testnet" }),
        { expirationTtl: 60 * 60 * 24 * 365 }
      );

      return json({ apiKey: rawKey }, {
        status: 201,
        headers: { "cache-control": "no-store", ...cors(request.headers.get("Origin")) }
      });
    }

    // --- Health check (unauthenticated) ---
    if (url.pathname === "/api/v1/health" || url.pathname === "/testnet/api/v1/health") {
      const upstream = new URL(env.RELAYER_BASE_URL);
      upstream.pathname = url.pathname;
      const resp = await fetch(upstream.toString(), {
        method: "GET",
        headers: { "authorization": `Bearer ${env.RELAYER_STATIC_API_KEY}` },
      });
      const out = new Headers(resp.headers);
      const ch = cors(request.headers.get("Origin"));
      for (const [k, v] of Object.entries(ch)) out.set(k, v);
      return new Response(resp.body, { status: resp.status, headers: out });
    }

    const auth = request.headers.get("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return unauthorized();
    const userKey = m[1];

    // If caller uses the static key, bypass KV-based auth entirely
    const isStatic = userKey === env.RELAYER_STATIC_API_KEY;

    let keyHash = null;
    if (!isStatic) {
      keyHash = await sha256Hex(`${env.KEY_SALT || ""}:${userKey}`);
      const recStr = await env.API_KEYS.get(`key:${keyHash}`);
      if (!recStr) return unauthorized();

      try {
        const rec = JSON.parse(recStr);
        if (!rec.active) return unauthorized();
        const isTestnetPath = url.pathname.startsWith("/testnet") || url.pathname.startsWith("/x402/testnet");
        if (rec.scope === "testnet" && !isTestnetPath) return unauthorized();
        if (rec.scope === "mainnet" && isTestnetPath) return unauthorized();
      } catch {
        return unauthorized();
      }

      // Only non-static keys can query usage
      if (url.pathname === "/usage/me" && request.method === "GET") {
        const day = new Date().toISOString().slice(0, 10);
        try {
          const sql = `SELECT SUM(_sample_interval) AS total, sumIf(_sample_interval, toStartOfDay(timestamp) = toStartOfDay(NOW())) AS today FROM channels_usage WHERE index1 = '${keyHash}' AND timestamp > NOW() - INTERVAL '90' DAY`;
          const resp = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
            {
              method: "POST",
              headers: { "Authorization": `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "text/plain" },
              body: sql,
            }
          );
          const result = await resp.json();
          const row = result?.data?.[0];
          return json(
            { keyHash, total: Number(row?.total ?? 0), today: Number(row?.today ?? 0), day },
            { headers: cors(request.headers.get("Origin")) }
          );
        } catch {
          return json(
            { keyHash, total: 0, today: 0, day, error: "usage_query_failed" },
            { status: 500, headers: cors(request.headers.get("Origin")) }
          );
        }
      }
    } else {
      // Static key can also query usage, but return minimal info
      if (url.pathname === "/usage/me" && request.method === "GET") {
        return json(
          { keyHash: "static", total: null, today: null, day: new Date().toISOString().slice(0, 10) },
          { headers: cors(request.headers.get("Origin")) }
        );
      }
    }

    // Proxy to upstream relayer
    const upstreamBase = new URL(env.RELAYER_BASE_URL);
    const upstream = new URL(env.RELAYER_BASE_URL);

    let targetPath = url.pathname;
    let shouldTrackUsage = false;
    if (request.method === "POST" && (url.pathname === "/" || url.pathname === "")) {
      targetPath = "/api/v1/plugins/channels/call";
      shouldTrackUsage = true;
    }
    else if (request.method === "POST" && (url.pathname === "/testnet" || url.pathname === "/testnet/")) {
      targetPath = "/testnet/api/v1/plugins/channels/call";
      shouldTrackUsage = true;
    }
    else if (url.pathname.startsWith("/x402/testnet")) {
      targetPath = "/testnet/api/v1/plugins/x402/call" + (url.pathname === "/x402/testnet" || url.pathname === "/x402/testnet/" ? "" : url.pathname.slice(13));
      shouldTrackUsage = true;
    }
    else if (url.pathname.startsWith("/x402")) {
      targetPath = "/api/v1/plugins/x402/call" + (url.pathname === "/x402" || url.pathname === "/x402/" ? "" : url.pathname.slice(5));
      shouldTrackUsage = true;
    }
    else {
      // For any other path, verify the user is using the static API key directly
      if (!isStatic) {
        return json(
          { success: false, code: 403, error: "Forbidden", message: "Forbidden Access" },
          { status: 403, headers: cors(request.headers.get("Origin")) }
        );
      }
    }

    upstream.pathname = targetPath;
    upstream.search   = url.search;

    // Headers / auth injection
    const headers = new Headers(request.headers);
    if (headers.get("X-Inject-Auth") === "1") headers.delete("X-Inject-Auth");
    headers.set("authorization", `Bearer ${env.RELAYER_STATIC_API_KEY}`);
    const isX402Path = url.pathname.startsWith("/x402");
    if (isX402Path) {
      headers.set("x-consumer-key", env.RELAYER_STATIC_API_KEY);
      headers.set("x-forwarded-consumer-key", userKey);
    } else {
      headers.set("x-consumer-key", userKey);
    }

    const init = {
      method: request.method,
      headers,
      body: (request.method === "GET" || request.method === "HEAD") ? undefined : request.body,
    };

    if (env.ORIGIN_OVERRIDE_HOST && upstreamBase.host === new URL(request.url).host) {
      init.cf = { resolveOverride: env.ORIGIN_OVERRIDE_HOST };
    }

    const resp = await fetch(upstream.toString(), init);

    // Track usage for non-static keys on backend plugin routes.
    if (!isStatic && shouldTrackUsage) {
      env.USAGE.writeDataPoint({
        indexes: [keyHash],
        blobs: [url.pathname, url.hostname],
        doubles: [1],
      });
    }
    const out  = new Headers(resp.headers);
    out.delete("www-authenticate");

    const origin = request.headers.get("Origin");
    const ch = cors(origin);
    for (const [k, v] of Object.entries(ch)) out.set(k, v);

    return new Response(resp.body, { status: resp.status, headers: out });
  }
};

function cors(origin) {
  const allow = origin ?? "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });
}

function unauthorized() {
  return json({ success: false, code: 401, error: "Unauthorized", message: "Unauthorized" }, { status: 401 });
}

async function sha256Hex(s) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
