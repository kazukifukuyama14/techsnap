#!/usr/bin/env bash
# Usage: bash scripts/generate_sync_plan.sh <source-project-id> <target-project-id>
# 例) Stagingの設定をProdに反映する計画を作る:
#   bash scripts/generate_sync_plan.sh techsnap-staging techsnap-prod
#
# 生成物:
#   env_audits/sync_plan_<SRC>_to_<DST>.sh
#
# 注意:
# - 破壊的操作は出力しません（作成/有効化系のみ、削除は提案メモ）。
# - App Hosting backend 作成はREST/CLIが流動的のためガイド行を出力します。
# - Firestoreのリージョン変更は不可能なので一致しない場合は警告のみ。
# - jq, firebase-tools, gcloud が必要です。

set -euo pipefail

SRC="${1:-}"; DST="${2:-}"
if [[ -z "$SRC" || -z "$DST" ]]; then
  echo "Usage: $0 <source-project-id> <target-project-id>" >&2
  exit 1
fi

BASE="env_audits"
SRC_DIR="${BASE}/${SRC}"
DST_DIR="${BASE}/${DST}"
PLAN="${BASE}/sync_plan_${SRC}_to_${DST}.sh"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1"; exit 1; }; }
need jq

if [[ ! -d "$SRC_DIR" || ! -d "$DST_DIR" ]]; then
  echo "Export not found. Please run:" >&2
  echo "  bash scripts/export_firebase_project.sh $SRC" >&2
  echo "  bash scripts/export_firebase_project.sh $DST" >&2
  exit 1
fi

mkdir -p "$BASE"

echo "#!/usr/bin/env bash" > "$PLAN"
echo "set -euo pipefail" >> "$PLAN"
echo "" >> "$PLAN"
echo "# Sync plan: ${SRC} -> ${DST}" >> "$PLAN"
echo "# このスクリプトは「不足分の追加」を支援します。実行前に内容を確認し、必要に応じてコメント解除してください。" >> "$PLAN"
echo "" >> "$PLAN"

# 1) Enabled APIs
echo "## Enabled APIs" >> "$PLAN"
if [[ -f "${SRC_DIR}/enabled-apis.txt" && -f "${DST_DIR}/enabled-apis.txt" ]]; then
  SRC_APIS=$(mktemp); DST_APIS=$(mktemp)
  sort -u "${SRC_DIR}/enabled-apis.txt" > "$SRC_APIS"
  sort -u "${DST_DIR}/enabled-apis.txt" > "$DST_APIS"
  ONLY_IN_SRC=$(comm -23 "$SRC_APIS" "$DST_APIS" | xargs)
  if [[ -n "${ONLY_IN_SRC:-}" ]]; then
    echo "# ${DST} で有効化推奨のAPI:" >> "$PLAN"
    echo "# $(comm -23 "$SRC_APIS" "$DST_APIS")" >> "$PLAN"
    echo "gcloud services enable \\ " >> "$PLAN"
    for api in $(comm -23 "$SRC_APIS" "$DST_APIS"); do
      echo "  ${api} \\" >> "$PLAN"
    done
    echo "  --project=${DST}" >> "$PLAN"
  else
    echo "# APIは一致しています。" >> "$PLAN"
  fi
fi
echo "" >> "$PLAN"

# 2) Firebase Web Apps（displayName ベースで不足チェック）
echo "## Firebase Web Apps（不足があれば作成）" >> "$PLAN"
STG_WEB_FILE="${SRC_DIR}/firebase-apps.json"
PRD_WEB_FILE="${DST_DIR}/firebase-apps.json"
if [[ -f "$STG_WEB_FILE" && -f "$PRD_WEB_FILE" ]]; then
  SRC_WEB=$(jq -r '.result.apps[]?|select(.platform=="WEB")|.displayName' "$STG_WEB_FILE" 2>/dev/null | sort -u || true)
  DST_WEB=$(jq -r '.result.apps[]?|select(.platform=="WEB")|.displayName' "$PRD_WEB_FILE" 2>/dev/null | sort -u || true)
  TMP_S=$(mktemp); TMP_D=$(mktemp)
  echo "$SRC_WEB" > "$TMP_S"; echo "$DST_WEB" > "$TMP_D"
  ONLY_IN_SRC=$(comm -23 <(sort "$TMP_S") <(sort "$TMP_D") | sed '/^$/d' || true)
  if [[ -n "${ONLY_IN_SRC:-}" ]]; then
    echo "# ${DST} に存在しないWebアプリ（作成コマンド例）" >> "$PLAN"
    while IFS= read -r name; do
      [[ -z "$name" ]] && continue
      echo "firebase apps:create web \"${name}\" --project ${DST}" >> "$PLAN"
    done <<< "$ONLY_IN_SRC"
  else
    echo "# Webアプリは一致しています。" >> "$PLAN"
  fi
fi
echo "" >> "$PLAN"

# 3) Hosting sites
echo "## Firebase Hosting Sites（不足があれば作成）" >> "$PLAN"
SRC_SITES=$(jq -r '.result[]?.name' "${SRC_DIR}/hosting-sites.json" 2>/dev/null | sed 's:^sites/::' | sort -u || true)
DST_SITES=$(jq -r '.result[]?.name' "${DST_DIR}/hosting-sites.json" 2>/dev/null | sed 's:^sites/::' | sort -u || true)
TMP_S=$(mktemp); TMP_D=$(mktemp)
echo "$SRC_SITES" > "$TMP_S"; echo "$DST_SITES" > "$TMP_D"
ONLY_IN_SRC=$(comm -23 "$TMP_S" "$TMP_D" | sed '/^$/d' || true)
if [[ -n "${ONLY_IN_SRC:-}" ]]; then
  echo "# ${DST} に不足しているサイト（作成コマンド）" >> "$PLAN"
  while IFS= read -r site; do
    [[ -z "$site" ]] && continue
    echo "firebase hosting:sites:create ${site} --project ${DST}" >> "$PLAN"
  done <<< "$ONLY_IN_SRC"
else
  echo "# Hosting sites は一致しています。" >> "$PLAN"
fi
echo "" >> "$PLAN"

# 4) App Hosting backends
echo "## App Hosting Backends（不足があれば作成ガイド）" >> "$PLAN"
SRC_BES_FILE="${SRC_DIR}/apphosting/backends_all.json"
DST_BES_FILE="${DST_DIR}/apphosting/backends_all.json"
if [[ -f "$SRC_BES_FILE" && -f "$DST_BES_FILE" ]]; then
  # 形式: "region backendId"
  SRC_BES=$(jq -r '.[]?|select(.location and .backend)|"\(.location) \(.backend)"' "$SRC_BES_FILE" 2>/dev/null | sort -u || true)
  DST_BES=$(jq -r '.[]?|select(.location and .backend)|"\(.location) \(.backend)"' "$DST_BES_FILE" 2>/dev/null | sort -u || true)
  TMP_S=$(mktemp); TMP_D=$(mktemp)
  echo "$SRC_BES" > "$TMP_S"; echo "$DST_BES" > "$TMP_D"
  ONLY_IN_SRC=$(comm -23 "$TMP_S" "$TMP_D" | sed '/^$/d' || true)
  if [[ -n "${ONLY_IN_SRC:-}" ]]; then
    echo "# ${DST} に不足しているバックエンド:" >> "$PLAN"
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      region="$(echo "$line" | awk '{print $1}')"
      beid="$(echo "$line" | awk '{print $2}')"
      echo "# - backendId: ${beid}, region: ${region}" >> "$PLAN"
    done <<< "$ONLY_IN_SRC"
    echo "# 作成方法（いずれか）:" >> "$PLAN"
    echo "# - Console: App Hosting > Backends > Create backend（上記IDとリージョンで）" >> "$PLAN"
    echo "# - CLI対話: firebase init（App Hosting を選択し、backendId/region を指定）" >> "$PLAN"
  else
    echo "# App Hosting backends は一致しています。" >> "$PLAN"
  fi
fi
echo "" >> "$PLAN"

# 5) Firestore（リージョン/インデックス/ルール）
echo "## Firestore 設定" >> "$PLAN"
SRC_LOC=$(jq -r '.databases[]?|select(.name|endswith("/(default)"))|.locationId' "${SRC_DIR}/firestore/databases.json" 2>/dev/null || echo "")
DST_LOC=$(jq -r '.databases[]?|select(.name|endswith("/(default)"))|.locationId' "${DST_DIR}/firestore/databases.json" 2>/dev/null || echo "")
if [[ -n "$SRC_LOC" && -n "$DST_LOC" && "$SRC_LOC" != "$DST_LOC" ]]; then
  echo "# 警告: Firestore デフォルトDBのリージョンが異なります（${SRC}:$SRC_LOC vs ${DST}:$DST_LOC）。リージョンは変更不可。" >> "$PLAN"
fi
echo "# ルール/インデックスを ${DST} にデプロイ（リポジトリのファイルを正として同期）" >> "$PLAN"
echo "# （必要ならコメント解除して実行）" >> "$PLAN"
echo "# firebase deploy --only firestore:rules,firestore:indexes --project ${DST}" >> "$PLAN"
echo "" >> "$PLAN"

# 6) Storage buckets
echo "## Cloud Storage Buckets（不足があれば作成候補）" >> "$PLAN"
SRC_BK=$(jq -r '.[].name|split("/")[-1]' "${SRC_DIR}/storage/buckets.json" 2>/dev/null | sort -u || true)
DST_BK=$(jq -r '.[].name|split("/")[-1]' "${DST_DIR}/storage/buckets.json" 2>/dev/null | sort -u || true)
TMP_S=$(mktemp); TMP_D=$(mktemp)
echo "$SRC_BK" > "$TMP_S"; echo "$DST_BK" > "$TMP_D"
ONLY_IN_SRC=$(comm -23 "$TMP_S" "$TMP_D" | sed '/^$/d' || true)
if [[ -n "${ONLY_IN_SRC:-}" ]]; then
  echo "# ${DST} に不足しているバケット（グローバル一意性に注意、必要なら名前調整）" >> "$PLAN"
  while IFS= read -r b; do
    [[ -z "$b" ]] && continue
    echo "# gsutil mb -p ${DST} -l asia-northeast1 gs://${b}" >> "$PLAN"
  done <<< "$ONLY_IN_SRC"
else
  echo "# Storage バケットは一致しています。" >> "$PLAN"
fi
echo "" >> "$PLAN"

# 7) Auth 設定
echo "## Auth 設定" >> "$PLAN"
echo "# Admin v2 のRESTでエクスポートしていますが、自動同期は推奨しません。" >> "$PLAN"
echo "# Console（Authentication > 設定）で ${SRC} と同一になるよう手動整合を推奨します。" >> "$PLAN"
echo "" >> "$PLAN"

echo "echo \"Review and run parts of this plan as needed: ${PLAN}\"" >> "$PLAN"

chmod +x "$PLAN"
echo "Generated plan: $PLAN"