#!/usr/bin/env bash
set -euo pipefail

URL="${1:?Usage: ./app-test-scriptgen.sh <url> --codebase <path> [--description <text>] [--credentials <json>] [--tester-file <path>] [--force-analysis] [--force-scripts] [--max-budget <usd>] [--output-dir <path>]}"
shift

# Resolve relative paths BEFORE cd-ing into autobot/
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --codebase|--tester-file|--output-dir)
      ARGS+=("$1")
      shift
      # Resolve the path argument to an absolute path
      ARGS+=("$(cd "$(dirname "$1")" && pwd)/$(basename "$1")")
      shift
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

cd "$(dirname "$0")/autobot"
npx tsx src/appTesterScriptGen.ts "$URL" "${ARGS[@]}"
