#!/usr/bin/env bash
set -euo pipefail

STG="${1:-}"
PRD="${2:-}"
if [[ -z "$STG" || -z "$PRD" ]]; then
  echo "Usage: $0 <staging-project-id> <prod-project-id>" >&2
  exit 1
fi

BASE="env_audits"
OUT_DIFF="${BASE}/diff_${STG}_${PRD}.txt"
OUT_SUM="${BASE}/summary.txt"

mkdir -p "$BASE"

# 1) Export both
bash scripts/export_firebase_project.sh "$STG"
bash scripts/export_firebase_project.sh "$PRD"

STG_DIR="${BASE}/${STG}/_normalized"
PRD_DIR="${BASE}/${PRD}/_normalized"

# 2) Unified diff of normalized JSON trees
echo "===== Full JSON diff (${STG} vs ${PRD}) =====" > "$OUT_DIFF"
diff -ruN "$STG_DIR" "$PRD_DIR" >> "$OUT_DIFF" || true

# 3) Summary (key items)
echo "# Summary (${STG} vs ${PRD})" > "$OUT_SUM"

# Enabled APIs difference
echo -e "\n## Enabled APIs" >> "$OUT_SUM"
comm -3 <(sort "env_audits/${STG}/enabled-apis.txt") <(sort "env_audits/${PRD}/enabled-apis.txt") | sed 's/^\t/PRD only: /; s/^/STG only: /' >> "$OUT_SUM" || true

# Firestore default DB location
echo -e "\n## Firestore" >> "$OUT_SUM"
STG_LOC=$(jq -r '.databases[]?|select(.name|endswith("/(default)"))|.locationId' "env_audits/${STG}/firestore/databases.json" 2>/dev/null || echo "")
PRD_LOC=$(jq -r '.databases[]?|select(.name|endswith("/(default)"))|.locationId' "env_audits/${PRD}/firestore/databases.json" 2>/dev/null || echo "")
echo "Default DB location => STG: ${STG_LOC:-N/A} | PRD: ${PRD_LOC:-N/A}" >> "$OUT_SUM"

# Firebase Web apps (names)
echo -e "\n## Firebase Web Apps" >> "$OUT_SUM"
STG_WEB=$(jq -r '.result.apps[]?|select(.platform=="WEB")|.displayName' "env_audits/${STG}/firebase-apps.json" 2>/dev/null | sort || true)
PRD_WEB=$(jq -r '.result.apps[]?|select(.platform=="WEB")|.displayName' "env_audits/${PRD}/firebase-apps.json" 2>/dev/null | sort || true)
echo "STG Web Apps:" >> "$OUT_SUM"; echo "${STG_WEB:-<none>}" >> "$OUT_SUM"
echo "PRD Web Apps:" >> "$OUT_SUM"; echo "${PRD_WEB:-<none>}" >> "$OUT_SUM"

# Hosting sites
echo -e "\n## Hosting Sites" >> "$OUT_SUM"
jq -r '.result[]?.name' "env_audits/${STG}/hosting-sites.json" 2>/dev/null | sort > "${BASE}/.stg_sites" || true
jq -r '.result[]?.name' "env_audits/${PRD}/hosting-sites.json" 2>/dev/null | sort > "${BASE}/.prd_sites" || true
echo "STG sites:" >> "$OUT_SUM"; cat "${BASE}/.stg_sites" 2>/dev/null >> "$OUT_SUM" || true
echo "PRD sites:" >> "$OUT_SUM"; cat "${BASE}/.prd_sites" 2>/dev/null >> "$OUT_SUM" || true
echo "Diff (Hosting sites):" >> "$OUT_SUM"
comm -3 "${BASE}/.stg_sites" "${BASE}/.prd_sites" | sed 's/^\t/PRD only: /; s/^/STG only: /' >> "$OUT_SUM" || true

# App Hosting backends (names per location)
echo -e "\n## App Hosting Backends" >> "$OUT_SUM"
jq -r '.[].location as $l | .[].backend' "env_audits/${STG}/apphosting/backends_all.json" 2>/dev/null | sort -u > "${BASE}/.stg_backends" || true
jq -r '.[].location as $l | .[].backend' "env_audits/${PRD}/apphosting/backends_all.json" 2>/dev/null | sort -u > "${BASE}/.prd_backends" || true
echo "STG backends:" >> "$OUT_SUM"; cat "${BASE}/.stg_backends" 2>/dev/null >> "$OUT_SUM" || true
echo "PRD backends:" >> "$OUT_SUM"; cat "${BASE}/.prd_backends" 2>/dev/null >> "$OUT_SUM" || true
echo "Diff (Backends):" >> "$OUT_SUM"
comm -3 "${BASE}/.stg_backends" "${BASE}/.prd_backends" | sed 's/^\t/PRD only: /; s/^/STG only: /' >> "$OUT_SUM" || true

# Storage buckets (namesのみ)
echo -e "\n## Storage Buckets" >> "$OUT_SUM"
jq -r '.[].name' "env_audits/${STG}/storage/buckets.json" 2>/dev/null | sort > "${BASE}/.stg_buckets" || true
jq -r '.[].name' "env_audits/${PRD}/storage/buckets.json" 2>/dev/null | sort > "${BASE}/.prd_buckets" || true
echo "Diff (Buckets):" >> "$OUT_SUM"
comm -3 "${BASE}/.stg_buckets" "${BASE}/.prd_buckets" | sed 's/^\t/PRD only: /; s/^/STG only: /' >> "$OUT_SUM" || true

# Auth config（ハッシュ比較）
echo -e "\n## Auth Config (hash)" >> "$OUT_SUM"
STG_AUTH_HASH=$(jq -S . "env_audits/${STG}/auth/config.json" 2>/dev/null | shasum -a 256 | awk '{print $1}' || echo "NA")
PRD_AUTH_HASH=$(jq -S . "env_audits/${PRD}/auth/config.json" 2>/dev/null | shasum -a 256 | awk '{print $1}' || echo "NA")
echo "STG: $STG_AUTH_HASH" >> "$OUT_SUM"
echo "PRD: $PRD_AUTH_HASH" >> "$OUT_SUM"
[[ "$STG_AUTH_HASH" != "$PRD_AUTH_HASH" ]] && echo "Auth config differs." >> "$OUT_SUM" || echo "Auth config matches." >> "$OUT_SUM"

echo -e "\nGenerated:" >> "$OUT_SUM"
echo "- ${OUT_DIFF}" >> "$OUT_SUM"
echo "- ${OUT_SUM}" >> "$OUT_SUM"

echo "Done. See:"
echo "  - $OUT_SUM"
echo "  - $OUT_DIFF"