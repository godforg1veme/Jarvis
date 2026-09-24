# NL Hysteria dual-name ACME renewal

Status: owner-approved 2026-09-24.

## Problem

NL serves six existing Hysteria clients with IP endpoint `94.183.208.56`
and TLS name `vpn.rilora.ru`; that public name points to DE. NL's current
certificate expires 2026-12-12 and its HTTP-01 renewal cannot succeed.
Changing only the live config would also make Host Agent's exact config
validation fail and a later client mutation would overwrite it.

## Decision

Create DNS-only `vpn-nl.rilora.ru` pointing to the NL address. An optional,
root-only `/etc/jarvis-vpn/hysteria2-acme-dns.json` selects Hysteria's built-in
Cloudflare DNS-01 ACME mode on NL and declares both the old and new names.
The file contains a Cloudflare token limited to DNS Write and Zone Read for
`rilora.ru`, valid only from the NL egress IP, with one-year expiry. Host Agent
validates its metadata and exact schema, generates the Hysteria config, and
compares it for health without returning or logging the token. In the absence
of this file, DE retains the existing HTTP-01 config exactly.

Hysteria must present valid publicly trusted certificates for both names
before `serverName` in NL's root-only client state is changed to the new name.
Existing clients keep the old SNI and must continue working; new exports and
dynamic subscriptions use the new SNI only after acceptance. The node IP,
client identities, passwords, obfuscation password, ports, and authentication
endpoint do not change. If issuance or either client path fails, restore the
previous config and leave the old state name unchanged.

## Acceptance

Verify both authoritative DNS and certificates, old and new live client
probes, Host Agent config health, Xray/Hysteria service health, subscription
export metadata, and automatic-renewal configuration. Never print the token,
URI, auth password, obfuscation secret, or full generated config. Existing
four-direction proof may become stale after deployment; recheck before any
new timer decision. Record token expiry and a renewal action well ahead of it.
