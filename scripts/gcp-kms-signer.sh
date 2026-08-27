#!/usr/bin/env bash
set -euo pipefail

# Create a Google Cloud KMS signer via the Channels API.
#
#
# Usage:
#   ENV=staging  API_KEY="<key>" GCP_SA_KEY_FILE=~/sa-key.json ./gcp-kms-signer.sh
#   ENV=testnet  API_KEY="<key>" GCP_SA_KEY_FILE=~/sa-key.json ./gcp-kms-signer.sh
#   ENV=mainnet  API_KEY="<key>" GCP_SA_KEY_FILE=~/sa-key.json ./gcp-kms-signer.sh
#
# Key location — either let it read Terraform outputs (default), or set all three:
#   KMS_LOCATION      (default: from `terraform output`, else GCP_REGION)
#   KMS_KEY_RING_ID   (default: `terraform output -raw kms_key_ring_name`)
#   KMS_KEY_ID        (default: `terraform output -raw kms_signing_key_name`)
#
# Optional:
#   KMS_KEY_VERSION   (default: 1)
#   TF_DIR            (default: .) — where to run `terraform output`
#   DRY_RUN=true      print the request with secrets redacted; send nothing
#
# The service-account private key is read from GCP_SA_KEY_FILE

: "${ENV:?ENV is required (staging|testnet|mainnet)}"
: "${API_KEY:?API_KEY is required (relayer API key)}"
: "${GCP_SA_KEY_FILE:?GCP_SA_KEY_FILE is required (path to the GCP service-account JSON key)}"

command -v jq >/dev/null || { echo "ERROR: jq is required" >&2; exit 1; }

case "$ENV" in
  staging)
    RELAYER_API_URL=<YOUR_STAGING_URL>  # TODO: replace with actual staging URL
    ;;
  testnet)
    RELAYER_API_URL=<YOUR_TESTNET_URL>  # TODO: replace with actual testnet URL
    ;;
  mainnet)
    RELAYER_API_URL=<YOUR_MAINNET_URL>  # TODO: replace with actual mainnet URL
    ;;
  *)
    echo "ERROR: ENV must be one of: staging, testnet, mainnet (got: $ENV)" >&2
    exit 2
    ;;
esac

API_TOKEN="Bearer $API_KEY"
KMS_KEY_VERSION="${KMS_KEY_VERSION:-1}"
TF_DIR="${TF_DIR:-.}"
DRY_RUN="${DRY_RUN:-false}"

# ── Service-account key file ────────────────────────────────────────────────
if [ ! -r "$GCP_SA_KEY_FILE" ]; then
  echo "ERROR: cannot read GCP_SA_KEY_FILE: $GCP_SA_KEY_FILE" >&2
  exit 1
fi

if ! jq -e 'type == "object"' "$GCP_SA_KEY_FILE" >/dev/null 2>&1; then
  echo "ERROR: $GCP_SA_KEY_FILE is not valid JSON" >&2
  exit 1
fi

# Fail early and by name if the key file is missing anything
MISSING=$(jq -r '
  ["private_key","private_key_id","project_id","client_email","client_id",
   "auth_uri","token_uri","auth_provider_x509_cert_url","client_x509_cert_url"]
  - (to_entries | map(select(.value != null and .value != "")) | map(.key))
  | join(", ")
' "$GCP_SA_KEY_FILE")

if [ -n "$MISSING" ]; then
  echo "ERROR: $GCP_SA_KEY_FILE is missing required field(s): $MISSING" >&2
  echo "  Expected a service-account key downloaded from GCP IAM." >&2
  exit 1
fi

SA_TYPE=$(jq -r '.type // ""' "$GCP_SA_KEY_FILE")
if [ "$SA_TYPE" != "service_account" ]; then
  echo "ERROR: $GCP_SA_KEY_FILE has type='$SA_TYPE', expected 'service_account'." >&2
  echo "  A user OAuth key or an ADC file will not work here." >&2
  exit 1
fi

SA_EMAIL=$(jq -r '.client_email' "$GCP_SA_KEY_FILE")
SA_PROJECT=$(jq -r '.project_id' "$GCP_SA_KEY_FILE")

# ── Key location ────────────────────────────────────────────────────────────
tf_out() {
  terraform -chdir="$TF_DIR" output -raw "$1" 2>/dev/null || true
}

if [ -z "${KMS_KEY_RING_ID:-}" ] || [ -z "${KMS_KEY_ID:-}" ]; then
  if ! command -v terraform >/dev/null; then
    echo "ERROR: KMS_KEY_RING_ID and KMS_KEY_ID are unset and terraform is not on PATH." >&2
    echo "  Set them explicitly, or run from a directory with terraform state." >&2
    exit 1
  fi
  KMS_KEY_RING_ID="${KMS_KEY_RING_ID:-$(tf_out kms_key_ring_name)}"
  KMS_KEY_ID="${KMS_KEY_ID:-$(tf_out kms_signing_key_name)}"
fi

KMS_LOCATION="${KMS_LOCATION:-${GCP_REGION:-$(tf_out region)}}"

for v in KMS_LOCATION KMS_KEY_RING_ID KMS_KEY_ID; do
  if [ -z "${!v}" ]; then
    echo "ERROR: $v is empty and could not be derived." >&2
    echo "  Set KMS_LOCATION, KMS_KEY_RING_ID and KMS_KEY_ID explicitly," >&2
    echo "  or set TF_DIR to a directory whose terraform state has the kms_* outputs." >&2
    exit 1
  fi
done

if ! [[ "$KMS_KEY_VERSION" =~ ^[0-9]+$ ]]; then
  echo "ERROR: KMS_KEY_VERSION must be a non-negative integer (got: $KMS_KEY_VERSION)" >&2
  exit 1
fi

echo "=== Create Google Cloud KMS Signer ==="
echo "  Environment:  $ENV"
echo "  API URL:      $RELAYER_API_URL"
echo "  SA e-mail:    $SA_EMAIL"
echo "  SA project:   $SA_PROJECT"
echo "  Key location: $KMS_LOCATION"
echo "  Key ring:     $KMS_KEY_RING_ID"
echo "  Key:          $KMS_KEY_ID (version $KMS_KEY_VERSION)"
echo ""

# ── Build the request body ──────────────────────────────────────────────────
build_body() {
  jq -n \
    --slurpfile sa "$GCP_SA_KEY_FILE" \
    --arg location "$KMS_LOCATION" \
    --arg key_ring_id "$KMS_KEY_RING_ID" \
    --arg key_id "$KMS_KEY_ID" \
    --argjson key_version "$KMS_KEY_VERSION" \
    '{
       type: "google_cloud_kms",
       config: {
         service_account: {
           private_key:                 $sa[0].private_key,
           private_key_id:              $sa[0].private_key_id,
           project_id:                  $sa[0].project_id,
           client_email:                $sa[0].client_email,
           client_id:                   $sa[0].client_id,
           auth_uri:                    $sa[0].auth_uri,
           token_uri:                   $sa[0].token_uri,
           auth_provider_x509_cert_url: $sa[0].auth_provider_x509_cert_url,
           client_x509_cert_url:        $sa[0].client_x509_cert_url,
           universe_domain:             ($sa[0].universe_domain // "googleapis.com")
         },
         key: {
           location:    $location,
           key_ring_id: $key_ring_id,
           key_id:      $key_id,
           key_version: $key_version
         }
       }
     }'
}

if [ "$DRY_RUN" = "true" ]; then
  echo "DRY RUN — request body (private key redacted), nothing sent:"
  build_body | jq '.config.service_account.private_key = "<redacted>"
                 | .config.service_account.private_key_id = "<redacted>"'
  exit 0
fi

RESPONSE=$(build_body | curl -sS -X POST "$RELAYER_API_URL/api/v1/signers" \
    -H "Authorization: $API_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary @-)

SIGNER_ID=$(echo "$RESPONSE" | jq -r '.data.id // .id // empty' 2>/dev/null || true)

if [ -z "$SIGNER_ID" ]; then
  echo "ERROR: Failed to create signer" >&2
  # Strip anything that could carry key material
  echo "$RESPONSE" | jq 'del(.. | .private_key?, .private_key_id?)' 2>/dev/null \
    || echo "$RESPONSE" >&2
  exit 1
fi

echo "  Signer ID: $SIGNER_ID"
echo ""
echo "$RESPONSE" | jq '{
  id: (.data.id // .id),
  type: (.data.type // .type),
  key: (.data.config.key // .config.key // null)
}' 2>/dev/null || echo "  (signer created; response was not JSON)"

echo ""
echo "Next: create the fund relayer with this signer_id"
