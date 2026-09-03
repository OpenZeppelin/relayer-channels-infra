#!/usr/bin/env bash
#
# run.sh — the reproducible entry point for the channels load test.
#
#   ./run.sh <profile> <env-file> [extra k6 args…]
#
# Profiles:
#   smoke       1 VU, 15 requests. The cheap "is it alive and sane" probe.
#   sustained   constant-arrival-rate: hold RATE req/s for DURATION regardless
#               of latency. Dropped iterations = the target cannot sustain the
#               rate. This is the capacity measurement.
#   capacity    ramping-vus: climb to RAMP_MAX VUs, hold, back off. For finding
#               the concurrency knee.
#
# The env file (see env/staging.env) carries every environment-specific fact:
# URL, contract, timeouts, per-type latency gates, rate defaults. Nothing about
# the target lives in this script, so a run is fully described by:
#   profile + env file + the commit hash printed below.
#
# Any variable already exported in the shell overrides the env file's value,
# e.g.  RATE=5 ./run.sh sustained env/staging.env
set -euo pipefail

usage() {
  echo "usage: ./run.sh <smoke|sustained|capacity> <env-file> [extra k6 args…]" >&2
  exit 2
}

PROFILE="${1:-}"
ENV_FILE="${2:-}"
[[ -n "$PROFILE" && -n "$ENV_FILE" ]] || usage
[[ -f "$ENV_FILE" ]] || { echo "env file not found: $ENV_FILE" >&2; exit 2; }
shift 2

VARS=(
  API_KEY BASE_URL PLUGIN_ID CONTRACT_ID TEST_TYPE PAYLOADS
  P95_MS P99_MS REQ_TIMEOUT SKIP_WAIT FUND_RELAYER_ID SUMMARY_OUT SKIP_HEALTHCHECK
  RATE DURATION PRE_VUS MAX_VUS RAMP_MAX RAMP_UP RAMP_HOLD
  P95_MS_FUNC_AUTH_NO_AUTH P95_MS_FUNC_AUTH_ADDRESS_AUTH
  P95_MS_XDR_PAYMENT P95_MS_XDR_UNSIGNED_SOROBAN
)

# Shell exports win over the env file: capture them before sourcing, restore
# after. (No associative arrays — macOS ships bash 3.2.)
for v in "${VARS[@]}"; do
  [[ -n "${!v:-}" ]] && printf -v "PRESET_$v" '%s' "${!v}"
done
# shellcheck source=/dev/null
source "$ENV_FILE"
for v in "${VARS[@]}"; do
  pv="PRESET_$v"
  [[ -n "${!pv:-}" ]] && printf -v "$v" '%s' "${!pv}"
done

: "${API_KEY:?API_KEY not set — the env file should resolve it from the shell (see env/staging.env)}"
: "${BASE_URL:?BASE_URL not set in $ENV_FILE}"

# Declared by the env file, not guessed from the hostname. Unset is refused.
case "${TARGET_KIND:-}" in
  test) ;;
  production)
    if [[ "${ALLOW_PRODUCTION:-}" != "yes" ]]; then
      echo "refusing: $ENV_FILE declares TARGET_KIND=production ($BASE_URL)." >&2
      echo "  This harness submits real transactions. xdr-payment spends real funds." >&2
      echo "  If that is intended, re-run with:" >&2
      echo "    ALLOW_PRODUCTION=yes $0 $PROFILE $ENV_FILE $*" >&2
      exit 3
    fi
    echo "⚠  PRODUCTION run against $BASE_URL — acknowledged via ALLOW_PRODUCTION=yes" >&2
    ;;
  "")
    echo "refusing: $ENV_FILE does not set TARGET_KIND." >&2
    echo "  Add TARGET_KIND=test for a test environment, or TARGET_KIND=production" >&2
    echo "  for one that holds real funds. See env/staging.env." >&2
    exit 2
    ;;
  *)
    echo "refusing: TARGET_KIND='$TARGET_KIND' in $ENV_FILE — use 'test' or 'production'." >&2
    exit 2
    ;;
esac

cd "$(dirname "$0")"

# k6 only sees variables passed with -e; forward every set one.
K6_ARGS=()
for v in "${VARS[@]}"; do
  [[ -n "${!v:-}" ]] && K6_ARGS+=(-e "$v=${!v}")
done

echo "── channels load test ─────────────────────────────────"
echo "   profile   $PROFILE"
echo "   env file  $ENV_FILE"
echo "   target    $BASE_URL"
echo "   commit    $(git rev-parse --short HEAD 2>/dev/null || echo 'n/a')"
echo "───────────────────────────────────────────────────────"

case "$PROFILE" in
  smoke)
    exec k6 run --vus 1 --iterations 15 "${K6_ARGS[@]}" "$@" load-test.k6.js
    ;;
  sustained)
    exec k6 run -e MODE=rate "${K6_ARGS[@]}" "$@" load-test.k6.js
    ;;
  capacity)
    exec k6 run -e MODE=ramp "${K6_ARGS[@]}" "$@" load-test.k6.js
    ;;
  *)
    usage
    ;;
esac
