# Security

Never place credentials, account identities or private context in Lab profiles,
issues or logs. Tools receive no credential broker, auth callback, Vault handle
or automatic memory access. Manifest validation grants no execution authority.

The ChatGPT coordinator requires a trusted host with OS-backed credentials,
a strict OIDC verifier and a private loopback listener. It has no default live
adapter. Credentials must never cross tool or renderer APIs.

Before public release the maintainer must configure private vulnerability
reporting in the public repository. No contact address is invented here.
