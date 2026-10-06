# Contributing to AITMI Lab

Thank you for improving the independent AITMI Lab.

## Scope

Contributions must keep Lab independently buildable with Node 20+ and
Apache-2.0 licensed. Do not add imports from AI.TMI Core, customer data,
private evaluation corpora, the Vault, personal memory or production
telemetry.

Tools and provider adapters must keep credentials, account identities,
private chat context and callback parameters inside the trusted local host.
They must never appear in a tool manifest, profile, test fixture, issue,
example or renderer response.

## Before opening a pull request

1. Run `npm test`.
2. Run `npm pack --dry-run` and inspect the allowlisted archive.
3. Add or update focused security tests for a changed capability, callback or
   provider boundary.
4. Use synthetic data only in examples and tests.

For a suspected security issue, do not open a public issue. Follow
SECURITY.md once private reporting is enabled on the repository.
