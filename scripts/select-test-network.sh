#!/bin/sh
set -eu

for command in docker node; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Missing command: %s\n' "$command" >&2
    exit 1
  }
done

network_ids=$(docker network ls -q)
start_octet=$(node -e 'process.stdout.write(String(Math.floor(Math.random() * 256)))')

for offset in $(seq 0 255); do
  octet=$(( (start_octet + offset) % 256 ))
  candidate="172.31.${octet}.0/29"
  if docker network inspect $network_ids --format '{{range .IPAM.Config}}{{.Subnet}}{{"\n"}}{{end}}' 2>/dev/null \
    | CANDIDATE="$candidate" node -e '
const fs = require("node:fs");
const ipaddr = require("ipaddr.js");

const candidate = process.env.CANDIDATE;
const [candidateIp, candidateRange] = ipaddr.parseCIDR(candidate);
const occupied = fs.readFileSync(0, "utf8").split(/\s+/).filter(Boolean);
const overlaps = occupied.some((subnet) => {
  try {
    const [network, range] = ipaddr.parseCIDR(subnet);
    if (network.kind() !== "ipv4") return false;
    return candidateIp.match(network, range[1]) || network.match(candidateIp, candidateRange[1]);
  } catch {
    return false;
  }
});
process.exit(overlaps ? 1 : 0);
'; then
    printf '%s\n' "$candidate"
    exit 0
  fi
done

printf '%s\n' 'Unable to find an available test network subnet.' >&2
exit 1
