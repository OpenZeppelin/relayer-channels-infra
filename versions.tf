terraform {
  required_version = ">= 1.5.0"

  # Configure your own backend. Example:
  # backend "s3" {
  #   bucket         = "my-terraform-state"
  #   key            = "relayer-channels/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "terraform-lock"
  # }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "< 6.0.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}
