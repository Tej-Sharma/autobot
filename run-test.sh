#!/usr/bin/env bash
set -euo pipefail

URL="${1:?Usage: ./run-test.sh <url> [--routes home,pricing] [--mode smoke|minimal|full] [--viewports desktop,mobile] [--no-judge]}"
shift

cd "$(dirname "$0")/autobot"
npx tsx src/localRunner.ts "$URL" "$@"
