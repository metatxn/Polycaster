#!/usr/bin/env bash

set -Eeuo pipefail

base_url="${MCP_BASE_URL:-http://127.0.0.1:8787}"
mode="dev"
run_live=0
timeout_seconds="${MCP_CURL_TIMEOUT_SECONDS:-15}"

usage() {
  cat <<'USAGE'
Usage: bash apps/mcp/scripts/curl-smoke-test.sh [options]

Runs curl smoke tests against an already-running Knoww MCP Worker.

Options:
  --base-url URL   Worker origin. Default: http://127.0.0.1:8787
  --mode MODE      dev or oauth. Default: dev
  --live           Call the live search_markets tool. Dev mode only.
  --timeout SEC    Per-request timeout from 1 to 120 seconds. Default: 15
  -h, --help       Show this help.

Examples:
  pnpm --filter @knoww/mcp dev
  bash apps/mcp/scripts/curl-smoke-test.sh

  bash apps/mcp/scripts/curl-smoke-test.sh --live

  bash apps/mcp/scripts/curl-smoke-test.sh \
    --base-url http://127.0.0.1:8790 \
    --mode oauth

The dev suite checks protocol negotiation, tool discovery, input validation,
method and path handling, and Host and Origin rejection. The oauth suite checks
the unauthenticated Bearer challenge and OAuth discovery endpoints. It does not
perform the interactive Google sign-in step.
USAGE
}

die() {
  printf 'Error: %s\n' "$1" >&2
  exit 2
}

while (($# > 0)); do
  case "$1" in
    --base-url)
      (($# >= 2)) || die "--base-url requires a value."
      base_url="$2"
      shift 2
      ;;
    --mode)
      (($# >= 2)) || die "--mode requires a value."
      mode="$2"
      shift 2
      ;;
    --live)
      run_live=1
      shift
      ;;
    --timeout)
      (($# >= 2)) || die "--timeout requires a value."
      timeout_seconds="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

[[ "$mode" == "dev" || "$mode" == "oauth" ]] ||
  die "--mode must be dev or oauth."
[[ "$timeout_seconds" =~ ^([1-9]|[1-9][0-9]|1[01][0-9]|120)$ ]] ||
  die "--timeout must be an integer from 1 to 120."
if ((run_live == 1)) && [[ "$mode" != "dev" ]]; then
  die "--live requires --mode dev."
fi

base_url="${base_url%/}"
if [[ ! "$base_url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] &&
  [[ ! "$base_url" =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$ ]]; then
  die "--base-url must be HTTPS, or HTTP on localhost or 127.0.0.1, with no path or credentials."
fi

command -v curl >/dev/null 2>&1 || die "curl is required."
if ! curl \
  --silent \
  --connect-timeout 3 \
  --max-time "$timeout_seconds" \
  --output /dev/null \
  "${base_url}/mcp"; then
  die "Could not reach ${base_url}/mcp. Start the Worker before running this script."
fi

response_body="$(mktemp)"
response_headers="$(mktemp)"
cleanup() {
  rm -f -- "$response_body" "$response_headers"
}
trap cleanup EXIT

passed=0
failed=0
declare -a failures=()
last_status=""

response_excerpt() {
  tr '\n' ' ' <"$response_body" | cut -c1-500
}

record_failure() {
  local name="$1"
  local reason="$2"
  ((failed += 1))
  failures+=("$name: $reason")
  printf 'not ok %d - %s\n' "$((passed + failed))" "$name"
  printf '  %s\n' "$reason"
  if [[ -s "$response_body" ]]; then
    printf '  response: %s\n' "$(response_excerpt)"
  fi
}

record_success() {
  local name="$1"
  ((passed += 1))
  printf 'ok %d - %s\n' "$((passed + failed))" "$name"
}

perform_request() {
  local method="$1"
  local path="$2"
  local protocol_version="$3"
  local body="$4"
  local origin="$5"
  local host="$6"
  local -a curl_args=(
    --silent
    --show-error
    --connect-timeout 3
    --max-time "$timeout_seconds"
    --request "$method"
    --output "$response_body"
    --dump-header "$response_headers"
    --write-out '%{http_code}'
    --header 'Accept: application/json, text/event-stream'
  )

  : >"$response_body"
  : >"$response_headers"
  if [[ -n "$protocol_version" ]]; then
    curl_args+=(--header "Mcp-Protocol-Version: $protocol_version")
  fi
  if [[ "$body" == *'"method":"server/discover"'* ]]; then
    curl_args+=(--header 'Mcp-Method: server/discover')
  fi
  if [[ -n "$body" ]]; then
    curl_args+=(
      --header 'Content-Type: application/json'
      --data "$body"
    )
  fi
  if [[ -n "$origin" ]]; then
    curl_args+=(--header "Origin: $origin")
  fi
  if [[ -n "$host" ]]; then
    curl_args+=(--header "Host: $host")
  fi

  if ! last_status="$(curl "${curl_args[@]}" "${base_url}${path}")"; then
    return 1
  fi
  return 0
}

run_case() {
  local name="$1"
  local method="$2"
  local path="$3"
  local expected_status="$4"
  local protocol_version="$5"
  local body="$6"
  local origin="$7"
  local host="$8"
  shift 8

  if ! perform_request \
    "$method" \
    "$path" \
    "$protocol_version" \
    "$body" \
    "$origin" \
    "$host"; then
    record_failure "$name" "curl could not reach ${base_url}${path}."
    return
  fi
  if [[ "$last_status" != "$expected_status" ]]; then
    record_failure \
      "$name" \
      "expected HTTP $expected_status, received HTTP $last_status."
    return
  fi

  local assertion kind needle
  for assertion in "$@"; do
    kind="${assertion%%:*}"
    needle="${assertion#*:}"
    case "$kind" in
      body)
        if ! grep -Fq -- "$needle" "$response_body"; then
          record_failure "$name" "response body is missing: $needle"
          return
        fi
        ;;
      header)
        if ! grep -Fiq -- "$needle" "$response_headers"; then
          record_failure "$name" "response headers are missing: $needle"
          return
        fi
        ;;
      not-body)
        if grep -Fq -- "$needle" "$response_body"; then
          record_failure "$name" "response body unexpectedly contains: $needle"
          return
        fi
        ;;
      *)
        die "Unknown assertion type in test '$name': $kind"
        ;;
    esac
  done

  record_success "$name"
}

readonly INITIALIZE_BODY='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"knoww-curl-smoke","version":"1.0.0"}}}'
readonly DISCOVER_BODY='{"jsonrpc":"2.0","id":"discover-1","method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"knoww-curl-smoke","version":"1.0.0"},"io.modelcontextprotocol/clientCapabilities":{}}}}'
readonly LIST_TOOLS_BODY='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
readonly INVALID_SEARCH_BODY='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_markets","arguments":{"query":""}}}'
readonly LIVE_SEARCH_BODY='{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"search_markets","arguments":{"query":"bitcoin","limit":1}}}'

printf 'Knoww MCP curl smoke test\n'
printf 'Target: %s\n' "$base_url"
printf 'Mode: %s\n\n' "$mode"

if [[ "$mode" == "dev" ]]; then
  run_case \
    "legacy initialize negotiates the protocol" \
    "POST" "/mcp" "200" "2025-11-25" "$INITIALIZE_BODY" "" "" \
    "body:knoww-mcp" \
    "body:2025-11-25" \
    "not-body:stack"

  run_case \
    "modern server discovery succeeds" \
    "POST" "/mcp" "200" "2026-07-28" "$DISCOVER_BODY" "" "" \
    "body:supportedVersions" \
    "body:2026-07-28"

  run_case \
    "tool discovery lists the five read-only tools" \
    "POST" "/mcp" "200" "2025-11-25" "$LIST_TOOLS_BODY" "" "" \
    "body:search_markets" \
    "body:get_market" \
    "body:get_event" \
    "body:get_orderbook" \
    "body:get_price_history"

  run_case \
    "invalid tool input returns a tool error" \
    "POST" "/mcp" "200" "2025-11-25" "$INVALID_SEARCH_BODY" "" "" \
    "body:isError" \
    "body:Input validation error" \
    "not-body:stack"

  run_case \
    "GET on the stateless MCP endpoint is rejected" \
    "GET" "/mcp" "405" "" "" "" "" \
    "not-body:stack"

  run_case \
    "an unknown path returns 404" \
    "POST" "/not-mcp" "404" "2025-11-25" "$LIST_TOOLS_BODY" "" "" \
    "body:NOT_FOUND" \
    "not-body:stack"

  run_case \
    "an unapproved Origin is rejected" \
    "POST" "/mcp" "403" "2025-11-25" "$INITIALIZE_BODY" "https://evil.example" "" \
    "body:Invalid Origin" \
    "not-body:stack"

  run_case \
    "an unapproved Host is rejected" \
    "POST" "/mcp" "403" "2025-11-25" "$INITIALIZE_BODY" "" "evil.example" \
    "body:FORBIDDEN" \
    "not-body:stack"

  if ((run_live == 1)); then
    run_case \
      "live market search returns event data" \
      "POST" "/mcp" "200" "2025-11-25" "$LIVE_SEARCH_BODY" "" "" \
      "not-body:\"isError\":true" \
      "body:events" \
      "not-body:stack"
  else
    printf '# live search skipped; pass --live to enable it\n'
  fi
else
  run_case \
    "an unauthenticated MCP request receives a Bearer challenge" \
    "POST" "/mcp" "401" "2025-11-25" "$INITIALIZE_BODY" "" "" \
    "header:WWW-Authenticate: Bearer" \
    "header:resource_metadata=" \
    "not-body:stack"

  run_case \
    "protected-resource metadata is published" \
    "GET" "/.well-known/oauth-protected-resource/mcp" "200" "" "" "" "" \
    "body:\"resource\"" \
    "body:markets:read" \
    "body:authorization_servers"

  run_case \
    "authorization-server metadata requires S256 PKCE" \
    "GET" "/.well-known/oauth-authorization-server" "200" "" "" "" "" \
    "body:authorization_endpoint" \
    "body:token_endpoint" \
    "body:S256"

  run_case \
    "an incomplete authorization request fails safely" \
    "GET" "/authorize" "400" "" "" "" "" \
    "not-body:stack"

  run_case \
    "an unknown OAuth path returns 404" \
    "GET" "/not-mcp" "404" "" "" "" "" \
    "not-body:stack"
fi

printf '\n%d passed, %d failed\n' "$passed" "$failed"
if ((failed > 0)); then
  printf 'Failures:\n' >&2
  printf '  - %s\n' "${failures[@]}" >&2
  exit 1
fi
