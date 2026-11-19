#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:3000}
POLL_ATTEMPTS=${POLL_ATTEMPTS:-120}
POLL_INTERVAL_SECONDS=${POLL_INTERVAL_SECONDS:-1}
payload='{"content":"The app crashes on the train. Please add an offline mode."}'

echo 'Submit feedback'
submitted=$(curl --fail-with-body --silent --show-error "$BASE_URL/feedback" \
  -H 'Content-Type: application/json' \
  -d "$payload")
echo "$submitted" | jq .
feedback_id=$(echo "$submitted" | jq -er '.id')

echo 'Poll the feedback list until analysis finishes'
for ((attempt=1; attempt<=POLL_ATTEMPTS; attempt++)); do
  feedback_list=$(curl --fail-with-body --silent --show-error "$BASE_URL/feedback")
  echo "$feedback_list" | jq '.items[] | {id, status, attemptCount}'
  status=$(echo "$feedback_list" | jq -r --arg id "$feedback_id" '.items[] | select(.id == $id) | .status')
  if [[ "$status" == DONE || "$status" == FAILED ]]; then
    break
  fi
  sleep "$POLL_INTERVAL_SECONDS"
done
if [[ "$status" != DONE && "$status" != FAILED ]]; then
  echo 'Analysis did not finish before the polling limit' >&2
  exit 1
fi

echo 'Get feedback with persisted attempts and analysis'
curl --fail-with-body --silent --show-error "$BASE_URL/feedback/$feedback_id" | jq .

echo 'Submit the same feedback again (duplicate: true)'
curl --fail-with-body --silent --show-error "$BASE_URL/feedback" \
  -H 'Content-Type: application/json' \
  -d "$payload" | jq .

echo 'Retry feedback (202 for FAILED; 409 expected when already DONE)'
retry_response=$(curl --silent --show-error -X POST "$BASE_URL/feedback/$feedback_id/retry" \
  -w '\n%{http_code}')
retry_status=${retry_response##*$'\n'}
echo "${retry_response%$'\n'*}" | jq .
echo "HTTP $retry_status"
if [[ "$status" == DONE ]]; then
  [[ "$retry_status" == 409 ]]
else
  [[ "$retry_status" == 202 ]]
fi
