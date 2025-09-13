#!/usr/bin/env bash
set -euo pipefail

PROJECT="${1:-}"
if [[ -z "$PROJECT" ]]; then
  echo "Usage: $0 <gcp-or-firebase-project-id>" >&2
  exit 1
fi

OUT="env_audits/${PROJECT}"
TMP="${OUT}/.tmp"
mkdir -p "$OUT" "$TMP"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1"; exit 1; }; }
need gcloud
need firebase
need jq
need curl

token() { gcloud auth print-access-token; }
rest_get() { curl -sfL -H "Authorization: Bearer $(token)" "$1"; }

echo "== Exporting project: $PROJECT =="
echo "Output dir: $OUT"

# Project/GCP metadata
gcloud projects describe "$PROJECT" --format=json > "$OUT/project.json"
# Billing info（RESTで安定取得）
rest_get "https://cloudbilling.googleapis.com/v1/projects/${PROJECT}/billingInfo" > "$OUT/billing.json" || true

# Enabled APIs
gcloud services list --enabled --project="$PROJECT" --format=json > "$OUT/enabled-apis.json"
gcloud services list --enabled --project="$PROJECT" --format="value(config.name)" | sort -u > "$OUT/enabled-apis.txt"

# IAM policy
gcloud projects get-iam-policy "$PROJECT" --format=json > "$OUT/iam-policy.json"

# Firebase Project info
rest_get "https://firebase.googleapis.com/v1beta1/projects/${PROJECT}" > "$OUT/firebase-project.json" || true

# Firebase apps (all platforms)
firebase apps:list --project "$PROJECT" --json > "$OUT/firebase-apps.json" || true

# Web apps SDK configs（個別取得・失敗は無視）
mkdir -p "$OUT/firebase-webapps"
if jq -e '.result.apps | arrays | length > 0' "$OUT/firebase-apps.json" >/dev/null 2>&1; then
  jq -r '.result.apps[] | select(.platform=="WEB") | .appId' "$OUT/firebase-apps.json" | while read -r APPID; do
    firebase apps:sdkconfig web "$APPID" --project "$PROJECT" --json > "$OUT/firebase-webapps/${APPID}.json" || true
  done
fi

# Hosting sites
firebase hosting:sites:list --project "$PROJECT" --json > "$OUT/hosting-sites.json" || true

# App Hosting: locations と各ロケーションの backends
mkdir -p "$OUT/apphosting"
if rest_get "https://firebaseapphosting.googleapis.com/v1beta/projects/${PROJECT}/locations" > "$OUT/apphosting/locations.json"; then
  jq -r '.locations[].locationId' "$OUT/apphosting/locations.json" 2>/dev/null | while read -r LOC; do
    rest_get "https://firebaseapphosting.googleapis.com/v1beta/projects/${PROJECT}/locations/${LOC}/backends" > "$OUT/apphosting/backends_${LOC}.json" || true
  done
  # 収集した backends の集約（名前だけ一覧）
  jq -s '[.[] | .backends[]? | {location: (.name|split("/")[3]), backend: (.name|split("/")[-1])}]' "$OUT"/apphosting/backends_*.json 2>/dev/null > "$OUT/apphosting/backends_all.json" || echo '[]' > "$OUT/apphosting/backends_all.json"
else
  echo '{}' > "$OUT/apphosting/locations.json"
  echo '[]' > "$OUT/apphosting/backends_all.json"
fi

# Firestore: Databases / Indexes / Fields
mkdir -p "$OUT/firestore"
rest_get "https://firestore.googleapis.com/v1/projects/${PROJECT}/databases" > "$OUT/firestore/databases.json" || echo '{}' > "$OUT/firestore/databases.json"

# 既定DBが存在する場合のみ詳細取得
if jq -e '.databases[]? | select(.name|endswith("/databases/(default)"))' "$OUT/firestore/databases.json" >/dev/null 2>&1; then
  rest_get "https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/collectionGroups/-/indexes" > "$OUT/firestore/indexes.json" || echo '{}' > "$OUT/firestore/indexes.json"
  rest_get "https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/collectionGroups/-/fields?filter=indexConfig.usesAncestorConfig=false%20OR%20ttlConfig:*" > "$OUT/firestore/fields.json" || echo '{}' > "$OUT/firestore/fields.json"
else
  echo '{}' > "$OUT/firestore/indexes.json"
  echo '{}' > "$OUT/firestore/fields.json"
fi

# Firestore Rules (releases と rulesets)
mkdir -p "$OUT/firestore_rules"
if rest_get "https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases?pageSize=50" > "$OUT/firestore_rules/releases.json"; then
  # 各 release に紐づく ruleset を取得
  jq -r '.releases[]?.rulesetName' "$OUT/firestore_rules/releases.json" 2>/dev/null | while read -r RULESET; do
    ID="${RULESET##*/}"
    rest_get "https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets/${ID}" > "$OUT/firestore_rules/ruleset_${ID}.json" || true
  done
fi

# Cloud Storage buckets
mkdir -p "$OUT/storage"
gcloud storage buckets list --project="$PROJECT" --format=json > "$OUT/storage/buckets.json" || echo '[]' > "$OUT/storage/buckets.json"

# Auth（Identity Platform/Firebase Auth 設定）存在すれば取得
mkdir -p "$OUT/auth"
rest_get "https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config" > "$OUT/auth/config.json" || echo '{}' > "$OUT/auth/config.json"

# 正規化済み（ソート）JSONも生成しておくと後の diff が読みやすい
NORM="${OUT}/_normalized"
mkdir -p "$NORM"
find "$OUT" -type f -name "*.json" ! -path "$NORM/*" | while read -r f; do
  rel="${f#$OUT/}"
  mkdir -p "$NORM/$(dirname "$rel")"
  jq -S . "$f" > "$NORM/$rel" 2>/dev/null || cp "$f" "$NORM/$rel"
done

echo "Done: $OUT"