# Security

Never place credentials, account identities or private context in Lab profiles,
issues or logs. Tools receive no credential broker, auth callback, Vault handle
or automatic memory access. Manifest validation grants no execution authority.

The ChatGPT coordinator requires a trusted host with OS-backed credentials,
a strict OIDC verifier and a private loopback listener. The explicit Windows
CLI sign-in uses current-user DPAPI, a locked encrypted credential record,
one-use PKCE callbacks and fixed OpenAI destinations. Credentials must never
cross tool or renderer APIs. This is not a Core credential bridge.

Use the public repository's private vulnerability reporting for suspected
security issues; do not disclose credential or private-content examples in
public issues. Maintainers must keep private reporting enabled. No contact
address is invented here.
