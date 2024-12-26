terraform {
  required_providers {
    dnsimple = {
      source  = "dnsimple/dnsimple"
      version = "1.8.0"
    }
  }
}

variable "dnsimple_account" {
  type      = number
  ephemeral = true
  nullable  = false
}

variable "dnsimple_token" {
  type      = string
  ephemeral = true
  nullable  = false
}

variable "dnsimple_zone" {
  type     = string
  nullable = false
}

provider "dnsimple" {
  token   = var.dnsimple_token
  account = var.dnsimple_account
}

resource "dnsimple_zone_record" "www_cname" {
  zone_name = var.dnsimple_zone
  name      = "www"
  type      = "CNAME"
  value     = "pickmyfruit.fly.dev"
}

resource "dnsimple_zone_record" "www_acme" {
  zone_name = var.dnsimple_zone
  name      = "_acme-challenge.www"
  type      = "CNAME"
  value     = "www.pickmyfruit.com.nm66l1.flydns.net."
}

resource "dnsimple_zone_record" "apex_redirect" {
  zone_name = var.dnsimple_zone
  name      = ""
  type      = "URL"
  value     = "https://www.${var.dnsimple_zone}"
}
