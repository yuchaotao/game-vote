#!/bin/sh
# Points yuchaotao.duckdns.org (www.yuchaotao.com is a CNAME to it) at this
# network's public IP; DuckDNS uses the address the request comes from.
# Run every 5 minutes by game-vote-duckdns.timer. Needs /etc/duckdns/token
# (see deploy/README.md); the token is never printed.
set -eu

DOMAIN=${DUCKDNS_DOMAIN:-yuchaotao}
TOKEN_FILE=${DUCKDNS_TOKEN_FILE:-/etc/duckdns/token}

if [ ! -r "$TOKEN_FILE" ]; then
  echo "duckdns: $TOKEN_FILE missing; see deploy/README.md" >&2
  exit 1
fi
token=$(tr -d '[:space:]' <"$TOKEN_FILE")

# The URL (with the token) goes to curl on stdin, not the command line, so it
# never shows up in the process list. ip= empty: DuckDNS takes the caller's IP.
result=$(printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip="\n' "$DOMAIN" "$token" |
  curl -fsS -m 20 --retry 2 -K -)

if [ "$result" != "OK" ]; then
  echo "duckdns: update failed (answer: $result)" >&2
  exit 1
fi
# Log only when the address changed, so the journal shows IP changes.
ip=$(curl -fsS -m 10 https://api.ipify.org || echo "?")
last=/var/lib/duckdns-last-ip
if [ "$(cat "$last" 2>/dev/null)" != "$ip" ]; then
  echo "duckdns: $DOMAIN.duckdns.org -> $ip"
  echo "$ip" >"$last"
fi
