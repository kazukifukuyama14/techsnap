# ローカル変数: allowedポートのリストをfirewallルール生成用のマップに変換
locals {
  firewall_allowed_tcp_ports = { for port in var.vpc_settings.allowed_tcp_ports : tostring(port) => tostring(port) }
  firewall_allowed_udp_ports = { for port in var.vpc_settings.allowed_udp_ports : tostring(port) => tostring(port) }
}

# リソース: インターネットから許可されたTCPポートへのINGRESSルール
resource "google_compute_firewall" "ingress_tcp" {
  for_each    = local.firewall_allowed_tcp_ports
  name        = "${local.prefix}-ingress-tcp-${each.value}"
  description = "Allow inbound TCP ${each.value} from the internet"
  network     = google_compute_network.techsnap_vpc.id
  direction   = "INGRESS"
  priority    = 1000

  source_ranges = ["0.0.0.0/0"]

  allow {
    protocol = "tcp"
    ports    = [each.value]
  }
}

# リソース: インターネットから許可されたUDPポートへのINGRESSルール
resource "google_compute_firewall" "ingress_udp" {
  for_each    = local.firewall_allowed_udp_ports
  name        = "${local.prefix}-ingress-udp-${each.value}"
  description = "Allow inbound UDP ${each.value} from the internet"
  network     = google_compute_network.techsnap_vpc.id
  direction   = "INGRESS"
  priority    = 1000

  source_ranges = ["0.0.0.0/0"]

  allow {
    protocol = "udp"
    ports    = [each.value]
  }
}

# リソース: Google HTTP(S) ロードバランサからバックエンドポートへのトラフィック許可
resource "google_compute_firewall" "ingress_lb_to_backend" {
  name        = "${local.prefix}-lb-to-backend"
  description = "Allow Google Cloud HTTP(S) Load Balancer traffic to backend port"
  network     = google_compute_network.techsnap_vpc.id
  direction   = "INGRESS"
  priority    = 1000

  source_ranges = [
    "35.191.0.0/16",
    "130.211.0.0/22"
  ]

  allow {
    protocol = "tcp"
    ports    = [tostring(var.cloud_run_settings.port)]
  }
}

# リソース: 全てのアウトバウンド通信を許可するEGRESSルール
resource "google_compute_firewall" "egress_all" {
  name        = "${local.prefix}-egress-all"
  description = "Allow all outbound traffic"
  network     = google_compute_network.techsnap_vpc.id
  direction   = "EGRESS"
  priority    = 65534

  destination_ranges = ["0.0.0.0/0"]

  allow {
    protocol = "all"
  }
}
