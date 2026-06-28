terraform {
  required_version = ">= 1.5.0"

  # Configure your own backend. Example:
  # backend "gcs" {
  #   bucket = "my-terraform-state"
  #   prefix = "relayer-channels/terraform.tfstate"
  # }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0, < 7.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}
