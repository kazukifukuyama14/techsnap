#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="$1"
KIND="$2"
KEY_ID="$3"

if [[ -z "${PROJECT_ID}" || -z "${KIND}" || -z "${KEY_ID}" ]]; then
  echo "Usage: $0 <PROJECT_ID> <KIND> <KEY_ID>" >&2
  exit 1
fi

gcloud config set project "$PROJECT_ID" --quiet >/dev/null

PAYLOAD=$(cat <<JSON
{
  "mutations": [
    {
      "delete": {
        "key": {
          "path": [
            { "kind": "$KIND", "name": "$KEY_ID" }
          ]
        }
      }
    }
  ]
}
JSON
)

echo "$PAYLOAD" | gcloud beta firestore commit --project="$PROJECT_ID" --database="(default)" --quiet >/dev/null
