/**
 * Channels plugin load test (k6)
 *
 * Reconstructed to match the invocation contract in the original `smoke.sh`:
 *   k6 run --vus N --duration D --rps R \
 *     -e API_KEY=... -e BASE_URL=... -e CONTRACT_ID=... -e TEST_TYPE=... \
 *     load-test.k6.js
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Run via ./run.sh <smoke|sustained|capacity> <env-file> — named, reproducible
 * profiles with per-environment config from env/*.env. Raw invocation, for
 * one-off shapes (generate payloads first — see README):
 *
 *   k6 run --vus 1 --iterations 15 \
 *     -e API_KEY=$KEY -e BASE_URL=$BASE \
 *     -e TEST_TYPE=func-auth-no-auth -e PAYLOADS=./payloads.json \
 *     load-test.k6.js
 *
 * Two things to know before changing the numbers.
 *
 * `--iterations` is a TOTAL across all VUs, not per VU. `--vus 40 --iterations
 * 15` does not test 40 VUs — 15 VUs do one request each and 25 sit idle. Above
 * ~5 VUs, scale iterations with VUs (e.g. `--iterations $((V*3))`).
 *
 * For the single-use types (xdr-payment, func-auth-address-auth) every level of
 * a sweep needs its OWN payload file. `iterationInTest` restarts at 0 on each
 * k6 run, so a shared file would resubmit the same payloads, and a replayed
 * Soroban nonce or a spent sequence number fails. And xdr-payment payloads die
 * 60s after generation — see the README.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * k6 has no Stellar SDK, so anything requiring a signature is pre-generated
 * off-line into a payloads file (see README). This script only replays payloads
 * and measures the result.
 *
 * Wire format (from src/client/channels-client.ts):
 *   direct mode   POST {BASE_URL}/                              Authorization: Bearer <key>
 *   relayer mode  POST {BASE_URL}/api/v1/plugins/{id}/call       x-api-key: <key>
 *   body          {"params": { ...request... }}
 *   response      {"success": bool, "data": ..., "error"?: ..., "metadata"?: ...}
 */

import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/+$/, '');
const API_KEY = __ENV.API_KEY || '';
const PLUGIN_ID = __ENV.PLUGIN_ID || '';
const TEST_TYPE = __ENV.TEST_TYPE || 'func-auth-no-auth';
const PAYLOADS_FILE = __ENV.PAYLOADS || './payloads.json';
const SKIP_WAIT = __ENV.SKIP_WAIT === 'true';
const FUND_RELAYER_ID = __ENV.FUND_RELAYER_ID || '';
const REQ_TIMEOUT = __ENV.REQ_TIMEOUT || '60s';
const SUMMARY_OUT = __ENV.SUMMARY_OUT || '';
const GATE = (__ENV.GATE || '') === 'true';
/**
 * Latency threshold, in ms. Set it to the TARGET's own request timeout —
 * a p95 above this value is unreachable because the service cuts the request
 * first. Read the live value from your task/service definition.
 */
const P95_MS = parseInt(__ENV.P95_MS || '20000', 10);
const P99_MS = parseInt(__ENV.P99_MS || '19000', 10);

/**
 * Load mode. Decides who controls the load shape:
 *
 *   cli   (default)  VUs/iterations/duration come from the k6 CLI, as in the
 *                    original smoke.sh. A VU loop BLOCKS on slow responses, so
 *                    under degradation the offered load quietly drops and the
 *                    run overstates capacity. Fine for smoke probes and sweeps.
 *   rate             constant-arrival-rate: hold RATE requests/sec regardless
 *                    of latency, spinning up VUs as needed (up to MAX_VUS).
 *                    Dropped iterations mean the target cannot sustain the
 *                    rate. This is the mode that measures capacity.
 *   ramp             ramping-vus: climb to RAMP_MAX VUs, hold, back off. For
 *                    finding the concurrency knee.
 */
const MODE = __ENV.MODE || 'cli';

const SCENARIOS = {
  cli: {},
  rate: {
    scenarios: {
      rate: {
        executor: 'constant-arrival-rate',
        rate: Number(__ENV.RATE || 3),
        timeUnit: '1s',
        duration: __ENV.DURATION || '5m',
        preAllocatedVUs: Number(__ENV.PRE_VUS || 10),
        maxVUs: Number(__ENV.MAX_VUS || 20),
      },
    },
  },
  ramp: {
    scenarios: {
      ramp: {
        executor: 'ramping-vus',
        startVUs: 1,
        stages: [
          { duration: __ENV.RAMP_UP || '2m', target: Number(__ENV.RAMP_MAX || 10) },
          { duration: __ENV.RAMP_HOLD || '2m', target: Number(__ENV.RAMP_MAX || 10) },
          { duration: '30s', target: 0 },
        ],
        gracefulStop: '30s',
      },
    },
  },
};

if (!(MODE in SCENARIOS)) {
  throw new Error(`Unknown MODE '${MODE}'. Use one of: ${Object.keys(SCENARIOS).join(', ')}`);
}

/** Test types that consume a payload per request and cannot be replayed. */
const SINGLE_USE = ['xdr-payment', 'func-auth-address-auth', 'xdr-unsigned-soroban'];
/** Test types whose payload is deterministic and safe to replay forever. */
const REUSABLE = ['func-auth-no-auth'];
const ALL_TYPES = [...SINGLE_USE, ...REUSABLE];

function resolveTypes(t) {
  if (t === 'all') return ALL_TYPES;
  if (ALL_TYPES.includes(t)) return [t];
  throw new Error(`Unknown TEST_TYPE '${t}'. Use one of: ${ALL_TYPES.join(', ')}, all`);
}

const ACTIVE_TYPES = resolveTypes(TEST_TYPE);

if (!BASE_URL) throw new Error('BASE_URL is required (-e BASE_URL=https://…)');
if (!API_KEY) throw new Error('API_KEY is required (-e API_KEY=…)');

const CALL_URL = PLUGIN_ID ? `${BASE_URL}/api/v1/plugins/${PLUGIN_ID}/call` : `${BASE_URL}/`;

const HEADERS = PLUGIN_ID
  ? { 'Content-Type': 'application/json', 'x-api-key': API_KEY, Authorization: `Bearer ${API_KEY}` }
  : { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` };

// ─────────────────────────────────────────────────────────────────────────────
// Payloads — loaded once in init, shared across VUs
// ─────────────────────────────────────────────────────────────────────────────

const payloads = new SharedArray('payloads', function () {
  let raw;
  try {
    raw = JSON.parse(open(PAYLOADS_FILE));
  } catch (e) {
    throw new Error(
      `Could not read payloads file '${PAYLOADS_FILE}': ${e}\n` +
        `Generate it first — see README ("Generating payloads").`
    );
  }

  // Accept either a flat array of {testType, params} or a keyed object.
  const flat = Array.isArray(raw)
    ? raw
    : Object.keys(raw).flatMap((k) => (raw[k] || []).map((p) => ({ testType: k, params: p })));

  const usable = flat.filter((p) => p && p.testType && p.params && ACTIVE_TYPES.includes(p.testType));

  for (const t of ACTIVE_TYPES) {
    const n = usable.filter((p) => p.testType === t).length;
    if (n === 0) throw new Error(`Payloads file has no entries for test type '${t}'`);
  }
  return usable;
});

/** Index payloads by type once per VU (SharedArray reads are comparatively costly). */
const byType = {};
for (const t of ACTIVE_TYPES) byType[t] = [];
for (let i = 0; i < payloads.length; i++) {
  const p = payloads[i];
  byType[p.testType].push(i);
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics
//
// HTTP success and plugin success are tracked separately on purpose. A 200 with
// {"success": false} is a plugin-level rejection, not a transport failure, and
// conflating the two is what made an earlier channels investigation misread a
// client-side timeout as an on-chain failure.
// ─────────────────────────────────────────────────────────────────────────────

const latency = new Trend('channels_latency', true);
const httpOk = new Rate('channels_http_ok');
const pluginOk = new Rate('channels_plugin_ok');
const pluginErrors = new Counter('channels_plugin_errors');
const transportErrors = new Counter('channels_transport_errors');
const payloadExhausted = new Counter('channels_payload_exhausted');
// Transport failures broken out by class. 504 (gateway/harness timeout), 502
// (upstream), connection-level (status 0), and 400-with-code are different
// root causes with different owners; one aggregate counter hides which one is
// happening. transportErrors above stays as the total.
const http504 = new Counter('channels_http_504');
const http502 = new Counter('channels_http_502');
const http400 = new Counter('channels_http_400');
const connErrors = new Counter('channels_conn_error');
const perType = {};
for (const t of ALL_TYPES) {
  perType[t] = {
    latency: new Trend(`channels_latency_${t.replace(/-/g, '_')}`, true),
    ok: new Rate(`channels_ok_${t.replace(/-/g, '_')}`),
  };
}

const thresholds = {
  channels_http_ok: ['rate>0.95'],
  channels_plugin_ok: GATE ? ['rate==1'] : ['rate>0.90'],
  channels_latency: [`p(95)<${P95_MS}`, `p(99)<${P99_MS}`],
  checks: GATE ? ['rate==1'] : ['rate>0.90'],
};

// Per-type latency gates. The types differ ~15x in latency (see README
// baselines), so under TEST_TYPE=all the blended p95 above is dominated by the
// slow types and gates nothing. Each active type gets its own gate: the
// environment file sets P95_MS_<TYPE> (e.g. P95_MS_FUNC_AUTH_ADDRESS_AUTH)
// from that environment's measured baseline; without an override the global
// P95_MS applies.
for (const t of ACTIVE_TYPES) {
  const key = t.replace(/-/g, '_');
  const override = parseInt(__ENV[`P95_MS_${key.toUpperCase()}`] || '', 10);
  thresholds[`channels_latency_${key}`] = [`p(95)<${Number.isFinite(override) ? override : P95_MS}`];
}

export const options = Object.assign(
  {
    // In MODE=cli, VUs / duration / rps come from the k6 CLI, matching smoke.sh.
    thresholds,
    discardResponseBodies: false,
    summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  },
  SCENARIOS[MODE]
);

// ─────────────────────────────────────────────────────────────────────────────
// Setup — fail fast on an unreachable or unauthorised target
// ─────────────────────────────────────────────────────────────────────────────

export function setup() {
  if (__ENV.SKIP_PREFLIGHT === 'true' || __ENV.SKIP_HEALTHCHECK === 'true') return { checked: false };

  // /api/v1/health returned 200 through the 2026-08-25 outage.
  const probeType = ACTIVE_TYPES.find((t) => REUSABLE.includes(t));
  if (!probeType) {
    console.warn(
      `⚠ preflight skipped — no reusable type active (${ACTIVE_TYPES.join(', ')}). ` +
        `Probing would consume a single-use payload and shift the run's indexing. ` +
        `Credentials and liveness stay unverified until the first iteration.`
    );
    return { checked: false };
  }

  const params = Object.assign({}, pickPayload(probeType, 0).params);
  if (SKIP_WAIT) params.skipWait = true;
  if (FUND_RELAYER_ID) params.fundRelayerId = FUND_RELAYER_ID;

  const res = http.post(CALL_URL, JSON.stringify({ params }), {
    headers: HEADERS,
    timeout: REQ_TIMEOUT,
    tags: { name: 'preflight' },
  });

  const where = `${CALL_URL} (${PLUGIN_ID ? 'relayer' : 'direct'} mode)`;

  if (res.status === 401 || res.status === 403) {
    exec.test.abort(
      `Credentials rejected: ${res.status} at ${where}. This is an auth failure, not an outage — ` +
        `check ${PLUGIN_ID ? 'API_KEY (sent as x-api-key) and PLUGIN_ID' : 'API_KEY'}.`
    );
  }
  if (res.status === 0) {
    exec.test.abort(`No response from ${where}: ${res.error || 'network error'}.`);
  }
  if (res.status !== 200) {
    exec.test.abort(
      `Preflight got ${res.status} from ${where}: ${String(res.body || '').slice(0, 200)}`
    );
  }

  const body = parseJson(res);
  if (!(body && body.success === true)) {
    exec.test.abort(
      `Plugin reachable but rejected the preflight ${probeType} call: ` +
        `${body && body.error ? String(body.error).slice(0, 200) : 'success was not true'}`
    );
  }

  console.log(
    `✓ preflight: real ${probeType} call succeeded — target ${CALL_URL}, ` +
      `types [${ACTIVE_TYPES.join(', ')}] (probe is tagged name=preflight, not counted in per-type rates)`
  );
  return { checked: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function pickPayload(testType, iteration) {
  const idxs = byType[testType];
  if (REUSABLE.includes(testType)) {
    // Deterministic payload — replay freely.
    return payloads[idxs[iteration % idxs.length]];
  }
  // Single-use: consume in order, never repeat. Exhaustion is a real condition
  // the operator needs to see, not something to paper over by wrapping around.
  if (iteration >= idxs.length) return null;
  return payloads[idxs[iteration]];
}

/** Per-VU dedupe set for error logging. */
const seenErrors = {};

/**
 * Log a distinct condition once per VU. Logging every occurrence turns a real
 * failure mode into thousands of identical lines and hides the rest of the run
 * output; logging nothing loses the reason, which only exists in the body.
 */
function logOnce(key, msg) {
  if (seenErrors[key]) return;
  seenErrors[key] = true;
  console.error(msg);
}

function parseJson(res) {
  try {
    return res.json();
  } catch (_) {
    return null;
  }
}

/**
 * Count a non-200 against its failure class. 504, 502, connection errors, and
 * 400s have different root causes with different owners; an operator reading
 * only an aggregate error count cannot tell which one they are looking at.
 */
function recordTransportError(res, testType, tags) {
  transportErrors.add(1, tags);
  if (res.status === 0 || res.error) {
    connErrors.add(1, tags);
  } else if (res.status === 504) {
    http504.add(1, tags);
  } else if (res.status === 502) {
    http502.add(1, tags);
  } else if (res.status === 400) {
    // The service puts a machine-readable reason in data.code (for example
    // ONCHAIN_FAILED, TIMEBOUNDS_TOO_FAR). Tag the counter with it.
    const body = parseJson(res);
    const code = ((body && body.data) || {}).code || '';
    http400.add(1, Object.assign({ code }, tags));
  }

  logOnce(
    `${testType}:http:${res.status}`,
    `[${testType}] HTTP ${res.status} ${res.status_text || ''} ${res.error ? `(${res.error}) ` : ''}— ${String(res.body || '(empty body)').slice(0, 400)}`
  );
}

export default function () {
  const iteration = exec.scenario.iterationInTest;
  const testType = ACTIVE_TYPES[iteration % ACTIVE_TYPES.length];
  // Per-type iteration counter so each type walks its own payload list.
  const typeIteration = Math.floor(iteration / ACTIVE_TYPES.length);

  const entry = pickPayload(testType, typeIteration);
  if (entry === null) {
    payloadExhausted.add(1, { test_type: testType });
    exec.test.abort(
      `Payloads exhausted for '${testType}' after ${byType[testType].length} requests. ` +
        `Regenerate with a higher --count, or use TEST_TYPE=func-auth-no-auth for an open-ended run.`
    );
    return;
  }

  const params = Object.assign({}, entry.params);
  if (SKIP_WAIT) params.skipWait = true;
  if (FUND_RELAYER_ID) params.fundRelayerId = FUND_RELAYER_ID;

  const tags = { name: 'plugins_call', test_type: testType };
  const res = http.post(CALL_URL, JSON.stringify({ params }), {
    headers: HEADERS,
    timeout: REQ_TIMEOUT,
    tags,
  });

  latency.add(res.timings.duration, tags);
  perType[testType].latency.add(res.timings.duration);

  const transportOk = res.status === 200;
  httpOk.add(transportOk, tags);
  if (!transportOk) recordTransportError(res, testType, tags);

  const body = transportOk ? parseJson(res) : null;
  const succeeded = !!(body && body.success === true);
  pluginOk.add(succeeded, tags);
  perType[testType].ok.add(succeeded);

  if (transportOk && !succeeded) {
    pluginErrors.add(1, tags);
    if (body && body.error) {
      const reason = String(body.error).slice(0, 200);
      logOnce(`${testType}:${reason}`, `[${testType}] plugin rejected: ${reason}`);
    }
  }

  check(res, {
    'http 200': () => transportOk,
    'body is json': () => body !== null,
    'success is true': () => succeeded,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const out = { stdout: textSummary(data) };
  if (SUMMARY_OUT) out[SUMMARY_OUT] = JSON.stringify(data, null, 2);
  return out;
}

function pct(m, k) {
  const v = m && m.values && m.values[k];
  return typeof v === 'number' ? v.toFixed(0) : 'n/a';
}
function rate(m) {
  const v = m && m.values && m.values.rate;
  return typeof v === 'number' ? (v * 100).toFixed(2) + '%' : 'n/a';
}
function count(m) {
  const v = m && m.values && m.values.count;
  return typeof v === 'number' ? String(v) : '0';
}

function textSummary(data) {
  const m = data.metrics || {};
  const lines = [
    '',
    '─────────────────────────────────────────────────────',
    ' Channels load test',
    '─────────────────────────────────────────────────────',
    ` target        ${CALL_URL}`,
    ` mode          ${PLUGIN_ID ? `relayer (plugin ${PLUGIN_ID})` : 'direct plugin service'}`,
    ` test types    ${ACTIVE_TYPES.join(', ')}`,
    '',
    ` requests      ${count(m.http_reqs)}`,
    ` http ok       ${rate(m.channels_http_ok)}`,
    ` plugin ok     ${rate(m.channels_plugin_ok)}`,
    ` transport err ${count(m.channels_transport_errors)}   (504: ${count(m.channels_http_504)}  502: ${count(
      m.channels_http_502
    )}  400: ${count(m.channels_http_400)}  conn: ${count(m.channels_conn_error)})`,
    ` plugin err    ${count(m.channels_plugin_errors)}`,
    ` exhausted     ${count(m.channels_payload_exhausted)}`,
    '',
    ` latency ms    med ${pct(m.channels_latency, 'med')}  p95 ${pct(m.channels_latency, 'p(95)')}  p99 ${pct(
      m.channels_latency,
      'p(99)'
    )}  max ${pct(m.channels_latency, 'max')}`,
  ];

  for (const t of ACTIVE_TYPES) {
    const key = t.replace(/-/g, '_');
    lines.push(
      ` ${t.padEnd(24)} ok ${rate(m[`channels_ok_${key}`]).padStart(7)}  p95 ${pct(
        m[`channels_latency_${key}`],
        'p(95)'
      )}ms`
    );
  }

  const failed = Object.keys(data.metrics || {}).filter(
    (k) => data.metrics[k].thresholds && Object.values(data.metrics[k].thresholds).some((t) => t.ok === false)
  );
  lines.push('');
  lines.push(failed.length ? ` ✗ thresholds breached: ${failed.join(', ')}` : ' ✓ all thresholds passed');
  lines.push('─────────────────────────────────────────────────────', '');
  return lines.join('\n');
}
