{{/* Nombre corto del chart. */}}
{{- define "devsecops-api.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Nombre completo del release (máx. 63 caracteres, límite DNS de Kubernetes). */}}
{{- define "devsecops-api.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "devsecops-api.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Tag efectivo: el de values (SHA del commit) o, si falta, appVersion. */}}
{{- define "devsecops-api.imageTag" -}}
{{- .Values.image.tag | default .Chart.AppVersion -}}
{{- end -}}

{{/* Referencia de imagen: repo:tag@digest cuando hay digest (inmutable). */}}
{{- define "devsecops-api.image" -}}
{{- $ref := printf "%s:%s" .Values.image.repository (include "devsecops-api.imageTag" .) -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" $ref .Values.image.digest -}}
{{- else -}}
{{- $ref -}}
{{- end -}}
{{- end -}}

{{- define "devsecops-api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "devsecops-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "devsecops-api.labels" -}}
helm.sh/chart: {{ include "devsecops-api.chart" . }}
{{ include "devsecops-api.selectorLabels" . }}
app.kubernetes.io/version: {{ include "devsecops-api.imageTag" . | trunc 63 | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: devsecops-gitops-challenge
{{- end -}}

{{- define "devsecops-api.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "devsecops-api.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* true si puede haber más de una réplica (condición para crear el PDB). */}}
{{- define "devsecops-api.multiReplica" -}}
{{- if or (and .Values.autoscaling.enabled (gt (int .Values.autoscaling.minReplicas) 1)) (and (not .Values.autoscaling.enabled) (gt (int .Values.replicaCount) 1)) -}}
true
{{- end -}}
{{- end -}}
