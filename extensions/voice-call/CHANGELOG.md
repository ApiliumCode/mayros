# Changelog

## 0.1.12

### Changes

- Version alignment with core Mayros release numbers.

## 0.1.11

### Changes

- Version alignment with core Mayros release numbers.

## 0.1.10

### Changes

- Version alignment with core Mayros release numbers.

## 0.1.9

### Changes

- Version alignment with core Mayros release numbers.

## 0.1.8

### Changes

- Version alignment with core Mayros release numbers.

## 0.1.7

### Changes

- Version alignment with core Mayros release numbers.

## 0.1.4

### Changes

- Version alignment with core Mayros release numbers.

## 0.1.3

### Changes

- Version alignment with core Mayros release numbers.

## 0.1.2

### Changes

- Version alignment with core Mayros release numbers.

## 0.1.1

### Changes

- Version alignment with core Mayros release numbers.

## 2026.1.26

### Changes

- Breaking: voice-call TTS now uses core `messages.tts` (plugin TTS config deep‑merges with core).
- Telephony TTS supports OpenAI + ElevenLabs; Edge TTS is ignored for calls.
- Removed legacy `tts.model`/`tts.voice`/`tts.instructions` plugin fields.
- Ngrok free-tier bypass renamed to `tunnel.allowNgrokFreeTierLoopbackBypass` and gated to loopback + `tunnel.provider="ngrok"`.

## 0.1.0

### Highlights

- First public release of the @apilium/mayros-voice-call plugin.

### Features

- Providers: Twilio (Programmable Voice + Media Streams), Telnyx (Call Control v2), and mock provider for local dev.
- Call flows: outbound notify vs. conversation modes, configurable auto‑hangup, and multi‑turn continuation.
- Inbound handling: policy controls (disabled/allowlist/open), allowlist matching, and inbound greeting.
- Webhooks: built‑in server with configurable bind/port/path plus `publicUrl` override.
- Exposure helpers: ngrok + Tailscale serve/funnel; dev‑only signature bypass for ngrok free tier.
- Streaming: OpenAI Realtime STT over media WebSocket with partial + final transcripts.
- Speech: OpenAI TTS (model/voice/instructions) with Twilio `<Say>` fallback.
- Tooling: `voice_call` tool actions for initiate/continue/speak/end/status.
- Gateway RPC: `voicecall.initiate|continue|speak|end|status` (+ legacy `voicecall.start`).
- CLI: `mayros voicecall` commands (call/start/continue/speak/end/status/tail/expose).
- Observability: JSONL call logs and `voicecall tail` for live inspection.
- Response controls: `responseModel`, `responseSystemPrompt`, and `responseTimeoutMs` for auto‑responses.
