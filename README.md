# AITMI Lab

AITMI Lab is a standalone local developer harness for creating and testing
permissioned AITMI tools. Its standalone source is licensed under Apache-2.0 (see LICENSE and NOTICE).
It can be used without AI.TMI Core.

## What is public here

- Tool manifests and capability declarations.
- Local developer commands and safe test fixtures.
- Provider-connection status that contains no token, key, account identity or
  request content.
- Reference integrations that use a provider's documented sign-in process.

## What is deliberately not here

AITMI Core, its Vault, privacy/semantic engine, personal memory, routing
decisions, production telemetry, provider credentials, private evaluation
corpora and customer data remain proprietary and are not dependencies of Lab.

## ChatGPT boundary

Lab may offer a documented `Continue with ChatGPT` flow only when the released
open-source project and the user's account are eligible under OpenAI's then
current programme. Lab must not transfer a ChatGPT-plan credential to a closed
application or use a browser session as a credential. Until that flow is
implemented and verified, the CLI reports it as unavailable rather than
pretending it is connected.

## Local use

```text
node src/cli.mjs init --profile ./aitmi-lab-profile.json
node src/cli.mjs status --profile ./aitmi-lab-profile.json
node src/cli.mjs create-tool my-tool --out ./my-tool
```

`create-tool` produces a capability manifest. A tool asks for capabilities;
it never receives an AI.TMI credential, Vault handle, unfiltered chat history
or authority to claim that content is protected.

## Publishing

The public source home is [aitmilab/aitmi-lab](https://github.com/aitmilab/aitmi-lab).
Publish only after configuring private vulnerability reporting and recording
release provenance. See CONTRIBUTING.md and RELEASE.md.

`src/chatgpt.mjs` is a host-only PKCE authorization coordinator with injected
browser, exchange, identity verification and OS credential-store adapters.
The CLI has no live sign-in adapter and cannot activate plan usage. See
RELEASE.md for the required verification and remaining host work.
