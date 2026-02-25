---
summary: "CLI reference for `mayros devices` (device pairing + token rotation/revocation)"
read_when:
  - You are approving device pairing requests
  - You need to rotate or revoke device tokens
title: "devices"
---

# `mayros devices`

Manage device pairing requests and device-scoped tokens.

## Commands

### `mayros devices list`

List pending pairing requests and paired devices.

```
mayros devices list
mayros devices list --json
```

### `mayros devices approve [requestId] [--latest]`

Approve a pending device pairing request. If `requestId` is omitted, Mayros
automatically approves the most recent pending request.

```
mayros devices approve
mayros devices approve <requestId>
mayros devices approve --latest
```

### `mayros devices reject <requestId>`

Reject a pending device pairing request.

```
mayros devices reject <requestId>
```

### `mayros devices rotate --device <id> --role <role> [--scope <scope...>]`

Rotate a device token for a specific role (optionally updating scopes).

```
mayros devices rotate --device <deviceId> --role operator --scope operator.read --scope operator.write
```

### `mayros devices revoke --device <id> --role <role>`

Revoke a device token for a specific role.

```
mayros devices revoke --device <deviceId> --role node
```

## Common options

- `--url <url>`: Gateway WebSocket URL (defaults to `gateway.remote.url` when configured).
- `--token <token>`: Gateway token (if required).
- `--password <password>`: Gateway password (password auth).
- `--timeout <ms>`: RPC timeout.
- `--json`: JSON output (recommended for scripting).

Note: when you set `--url`, the CLI does not fall back to config or environment credentials.
Pass `--token` or `--password` explicitly. Missing explicit credentials is an error.

## Notes

- Token rotation returns a new token (sensitive). Treat it like a secret.
- These commands require `operator.pairing` (or `operator.admin`) scope.
