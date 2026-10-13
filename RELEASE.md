# Extraction and release

Copy only this directory into a clean repository. Node 20+ is the only runtime
prerequisite. Run `npm test` and `npm pack --dry-run` in that clean directory.
No parent workspace, Core, Vault, privacy engine or customer data is required.
The package allowlist excludes profiles, tests and repository metadata.

The public source home is https://github.com/aitmilab/aitmi-lab. Before a
release, verify private vulnerability reporting remains enabled, record the
source commit and package SHA-256 in the release notes, and verify the archive
contains only the package allowlist. Publishing this standalone source does
not activate a closed-Core ChatGPT route, establish account eligibility, or
qualify a live provider request. Those are separate checks.

The host-only coordinator follows the official contract reviewed 2026-10-06:
https://developers.openai.com/siwc/token-sharing-open-source/sign-in
It implements PKCE, state, nonce handoff, issued client IDs, separate plan
scopes, one-use attempts and a five-minute authorization deadline.
The injected verifier MUST validate signature/JWKS, issuer, audience, expiry
and nonce; the broker MUST reject a returning account identity mismatch.
The host owns secure callback listening, refresh, revocation and per-request
eligibility checks before inference.

2026-10-07 host implementation: `connect chatgpt` now opens the system browser
after binding a private ephemeral 127.0.0.1 callback. Fixed OpenAI token/JWKS
endpoints, RS256 signature/issuer/audience/nonce/expiry validation, returning
subject matching and current-user Windows DPAPI storage are implemented.
All 27 standalone tests passed, including real loopback rejection/closure,
real Windows DPAPI persistence, OpenRouter code exchange, ChatGPT refresh and
discovered same-origin revocation. Provider responses in tests are synthetic;
live user consent, Responses inference, provider refresh/revocation acceptance
and installer qualification are not certified by these tests. No automatic
Core activation. The live ChatGPT attempt timed out with unavailable; no verified
owner sign-in has been reported.
The documented dynamic registration flow needs no partner API key or client
secret; a pre-issued client ID is not inherently required for eligible Lab
use. Provider/account eligibility and the Lab/Core boundary still apply.

Windows internal-UAT v83 additionally bundles the Lab status/sign-in panel and
unmodified @github/copilot-win32-x64 1.0.92 / @github/copilot-sdk 1.0.16, with their
vendor licenses retained. Those components are not relicensed as Apache-2.0.
The panel requires a per-launch bearer capability and exact Origin for actions,
exposes only closed connection states, and has no Node or Core preload bridge.
31 Lab tests passed on this Windows checkout, including real isolated Copilot
CLI/SDK startup (unsigned-in), real DPAPI and loopback tests. Packaged v83 passed
native startup and Lab-panel/process-tree shutdown tests. Live user authorization
and inference remain unverified; do not describe these as all-provider acceptance.
The native Copilot test is optional when its separately licensed runtime is absent
from a clean standalone extraction. Claude remains disabled. v83 is an unsigned
internal directory package, not a qualified signed installer or public Beta.

The current source implements explicit account-model listing and harmless
inference tests for ChatGPT/OpenRouter/Copilot. A 47-test Windows source run
passed with no skips in the enclosing development checkout, including actual
native SDK empty-mode startup/refusal in an unsigned-in profile. The clean
standalone checkout passed 46 tests with one expected skip because it does not
bundle Copilot vendor binaries. An initial native check revealed that empty mode
requires an explicit baseDirectory; this was supplied within the isolated Lab
profile and the real-runtime check then passed. Inference responses in automated
tests are synthetic. Owner consent, allowance/billing and completed live
inference remain UAT items. These functions do not authorize a closed-Core
ChatGPT route.
