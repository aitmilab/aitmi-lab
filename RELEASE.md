# Extraction and release

Copy only this directory into a clean repository. Node 20+ is the only runtime
prerequisite. Run `npm test` and `npm pack --dry-run` in that clean directory.
No parent workspace, Core, Vault, privacy engine or customer data is required.
The package allowlist excludes profiles, tests and repository metadata.

The public source home is https://github.com/aitmilab/aitmi-lab. Before a
release, configure private vulnerability reporting, record the source commit
and package SHA-256 in the release notes, and verify the archive contains only
the package allowlist. Public publishing and live provider authorization have
not been performed by this source preparation.

The host-only coordinator follows the official contract reviewed 2026-10-06:
https://developers.openai.com/siwc/token-sharing-open-source/sign-in
It implements PKCE, state, nonce handoff, issued client IDs, separate plan
scopes, one-use attempts and a five-minute authorization deadline.
The injected verifier MUST validate signature/JWKS, issuer, audience, expiry
and nonce; the broker MUST reject a returning account identity mismatch.
The host owns secure callback listening, refresh, revocation and per-request
eligibility checks before inference. The CLI cannot activate plan usage.
