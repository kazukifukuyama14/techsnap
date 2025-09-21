variable "project_id" {
  description = "Terraform で管理する GCP プロジェクト ID (production)。"
  type        = string
}

variable "region" {
  description = "主要リソースを配置するリージョン (例: asia-northeast1)。"
  type        = string
}

variable "environment" {
  description = "環境識別子。基本的には prod 固定。"
  type        = string
  default     = "prod"
}

variable "additional_labels" {
  description = "必要に応じて追加する共通ラベル。"
  type        = map(string)
  default     = {}
}
