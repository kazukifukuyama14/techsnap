# ドメイン名の定義
variable "domain" {
  description = "Techsnap のプライマリ ドメイン名 (DNS、証明書などで使用)"
  type        = string
  default     = ""
}

# GCP プロジェクトの設定
variable "project_settings" {
  description = "GCP プロジェクトの設定"
  type = object({
    project     = string
    environment = string
    region      = string
    domain      = string
  })
}

# GCP プロジェクト ID の定義
variable "project_id" {
  description = "GCP プロジェクトの ID"
  type        = string
}

# Artifact Registry の設定
variable "artifact_registry_settings" {
  description = "Artifact Registry の設定"
  type = object({
    repository_name          = string
    location                 = string
    format                   = string
    cleanup_keep_version     = optional(number, 2)
    cleanup_delete_tag_state = optional(string, "ANY")
  })
}

variable "env" {
  description = "環境名 (例: ステージングまたは本番環境)。未指定時は project_settings.environment を使用"
  type        = string
  default     = null
}

variable "service_account_email" {
  description = "Artifact Registry に権限を付与するサービスアカウント (空文字で Cloud Run サービスアカウントを使用)"
  type        = string
  default     = ""
}

# Cloud DNS の設定
variable "cloud_dns_settings" {
  description = "Cloud DNS の設定"
  type = object({
    zone_name = string
    domain    = string
  })
}

# Cloud Run の設定
variable "cloud_run_settings" {
  description = "Cloud Run の設定"
  type = object({
    service_name  = string
    image         = string
    cpu           = number
    memory        = string
    max_instances = number
    concurrency   = number
    port          = number
    env_vars      = map(string)
  })
}

# IAM の設定
variable "iam_settings" {
  description = "IAM の設定"
  type = object({
    service_account_name = string
    roles                = list(string)
  })
}

variable "datastore_iam_roles" {
  description = "Datastore へアクセスさせるために Cloud Run サービスアカウントへ付与する IAM ロール一覧"
  type        = list(string)
  default     = []
}

# Cloud SQL の設定
variable "monitoring_settings" {
  description = "Monitoring の設定"
  type = object({
    workspace_name = string
    location       = string
  })
}

# Logging の設定
variable "logging_settings" {
  description = "Logging の設定"
  type = object({
    log_sink_name = string
    destination   = string
    filter        = string
  })
}

# Secrets Manager の設定
variable "secrets_manager_settings" {
  description = "Secrets Manager の設定"
  type = object({
    secret_name = string
    replication = string
  })
}

# VPC の設定
variable "vpc_settings" {
  description = "ネットワークの設定"
  type = object({
    vpc_name          = string
    subnet_name       = string
    subnet_cidr       = string
    firewall_name     = string
    allowed_tcp_ports = list(number)
    allowed_udp_ports = list(number)
  })
}
