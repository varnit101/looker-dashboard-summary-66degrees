variable "project_id" {
  type = string
  default = "pandera-bi-demo"
}

variable "deployment_region" {
  type = string
  default = "us-central1"
}

variable "docker_image" {
    type = string
    default = "gcr.io/cloud-builders/docker"
}

variable "cloud_run_service_name" {
    type = string
    default = "dashboard-summary-service"
}

variable "genai_client_secret_value" {
  description = "The value for the GENAI_CLIENT_SECRET"
  type        = string
  sensitive   = true
  default = "YOUR VALUE"
}
