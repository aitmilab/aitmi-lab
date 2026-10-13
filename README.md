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
application or use a browser session as a credential. The Windows CLI now
implements a live browser sign-in host. A verified sign-in establishes Lab's
connection only; it does not activate Core or prove inference compatibility.

## Local use

```text
node src/cli.mjs init --profile ./aitmi-lab-profile.json
node src/cli.mjs status --profile ./aitmi-lab-profile.json
node src/cli.mjs connect chatgpt
node src/cli.mjs check chatgpt
node src/cli.mjs disconnect chatgpt
node src/cli.mjs connect openrouter
node src/cli.mjs check openrouter
node src/cli.mjs disconnect openrouter
node src/cli.mjs create-tool my-tool --out ./my-tool
```

`create-tool` produces a capability manifest. A tool asks for capabilities;
it never receives an AI.TMI credential, Vault handle, unfiltered chat history
or authority to claim that content is protected.

## Controlled Workspace UI package builders

`src/ui.mjs` provides the five declarative UI contribution builders named in
the Workspace specification. It has no Core dependency, network call or
credential access:

```javascript
import { createUi } from "./src/ui.mjs";
const aitmi = { ui: createUi({
  version: 1, id: "aitmi-lab.example", name: "example", entry: "index.mjs",
  capabilities: ["protected-input"],
}) };
aitmi.ui.panel({ id: "overview", title: "Overview", text: "Extension content" });
aitmi.ui.command({ id: "check", label: "Check selection",
  action: "check-compose", capabilities: ["protected-input"] });
aitmi.ui.status({ id: "progress", state: "idle" });
aitmi.ui.artifact({ id: "report", title: "Report", format: "text", content: "Result" });
aitmi.ui.terminalOutput({ id: "run", phase: "completed", count: 1 });
const packageToReview = aitmi.ui.package();
```

Packages contain at most 20 uniquely identified contributions and 64 KiB of
UTF-8 JSON. Text/table artifacts are data, not executable markup. Raw ANSI,
escape/direction-control codes, arbitrary command execution and host security
or provider-status fields are not accepted. Status and Terminal phases are
extension-reported, not evidence of a Core execution.

Validation is **not** privacy clearance or capability approval. A Core host
must separately review the package, approve declared capabilities, apply its
privacy policy to content and execute supported commands through Core.
Core's source now has a privileged, project-scoped, session-only review and
approval boundary. It withholds private/uncertain content, requires the exact
declared capability consent, and resolves only named Core actions. The manual
JSON import/review surface displays these contributions in a labelled region;
status/events are extension-reported, and markup is literal text, not executable.
The two currently supported command actions open Core's draft privacy check or
protected-copy control. Arbitrary tool/shell execution and draft/artifact data
access are not provided. Source browser acceptance has passed, but final
packaged and installed-model qualification is still in progress. These builders
alone do not install an extension or activate its UI.

## Publishing

The public source home is [aitmilab/aitmi-lab](https://github.com/aitmilab/aitmi-lab).
Publish only after configuring private vulnerability reporting and recording
release provenance. See CONTRIBUTING.md and RELEASE.md.

`src/chatgpt.mjs` is a host-only PKCE authorization coordinator with injected
browser, exchange, identity verification and OS credential-store adapters.
`src/chatgpt-host.mjs` supplies the private loopback listener, fixed-endpoint
exchange and RS256/JWKS identity validation. On Windows the CLI uses current-user
DPAPI to encrypt a single-account record under Local AppData/AITMI-Lab; no
plaintext fallback is permitted. The browser opens only on explicit `connect`.
ChatGPT `check` checks the local grant/expiry and refreshes expired tokens; it
does not send an inference request or establish live model eligibility. Sign-out
attempts remote revocation then clears tokens locally, retaining the registration.
A false `remoteRevocationConfirmed` requires disconnecting the app in ChatGPT
Settings if remote revocation is needed.
OpenRouter `check` calls its key-info endpoint without sending a prompt.
OpenRouter `disconnect` removes the local key only: revoke it in OpenRouter to
end remote access. OpenRouter billing is separate from provider subscriptions.
Non-Windows credential backends, multiple-account selection and general Lab chat
remain unfinished. The Windows internal-UAT package now bundles this separate companion
and an unmodified Copilot CLI/SDK. Claude remains a disabled stub by request;
an installed Claude CLI alone does not establish permission.
CLI `status` currently describes tool profiles, not the protected OAuth record.
See RELEASE.md for verification and remaining host work.

OAuth uses the system browser, never an app-controlled login webview. In the
Windows internal-UAT package, Connections > Open provider sign-in (or Help >
Provider sign-in) opens the isolated Lab panel with connection status and explicit
sign-in/check controls. It cannot read login pages, cookies or provider passwords.
Credentials stay in Lab, and a Lab connection does not activate a Core chat route.
Copilot uses its native credential store in an isolated configuration directory;
if the vendor falls back to a plaintext token, Lab reports storage-needs-attention
instead of connected. Resolve the OS credential-store problem before testing.
Copilot remote account management stays with GitHub; no invented logout API is
offered. The standalone npm package does not include the Copilot vendor binaries.

The panel also supports Load models, explicit model selection and Send harmless
inference test for ChatGPT, OpenRouter and Copilot. Confirmation is required for
each test: it sends only the displayed invented prompt requesting AITMI_OK and
may consume plan allowance or API credits. No free-form prompt, chat, document or
memory is accepted by this endpoint. ChatGPT requires response.completed from the
public Responses API with store:false/stream:true; failed/incomplete/interrupted
streams cannot pass. OpenRouter disables automatic fallback and requires a complete
reply. Copilot uses SDK empty mode and denies tools/config discovery/skills/session
sharing. UI results distinguish completed inference from matching the exact test
reply; model listing and sign-in alone do not prove inference access. This is a
Lab UAT test path, not a Core subscription-route bridge or full chat implementation.
