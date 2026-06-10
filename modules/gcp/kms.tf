# ---------------------------------------------------------------------------
# Cloud KMS
#
# Creates a keyring and an asymmetric signing key for Stellar transaction
# signing. The Cloud Run service account is granted permission to use the key.
# ---------------------------------------------------------------------------

resource "google_kms_key_ring" "this" {
  project  = var.project_id
  name     = "${local.app_name}-keyring"
  location = var.region

  depends_on = [google_project_service.apis["cloudkms.googleapis.com"]]
}

resource "google_kms_crypto_key" "signing" {
  name     = "${local.app_name}-signing"
  key_ring = google_kms_key_ring.this.id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm        = "EC_SIGN_ED25519"
    protection_level = "SOFTWARE"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Grant the Cloud Run service account permission to sign with this key
resource "google_kms_crypto_key_iam_member" "cloud_run_signer" {
  crypto_key_id = google_kms_crypto_key.signing.id
  role          = "roles/cloudkms.signerVerifier"
  member        = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Grant the Cloud Run service account permission to view the public key
resource "google_kms_crypto_key_iam_member" "cloud_run_viewer" {
  crypto_key_id = google_kms_crypto_key.signing.id
  role          = "roles/cloudkms.publicKeyViewer"
  member        = "serviceAccount:${google_service_account.cloud_run.email}"
}
