# RFC: response consumption pipeline

Status: superseded by and incorporated into the v0.3 response ownership API.

True Streaming과 Buffered 본문 크기 상한은 [v0.3 Streaming과 본문 안전성 RFC](v0.3-streaming-body-safety.md)에서 별도로 정의합니다.

## Motivation

HTTP execution, response decoding, and application schema validation fail for different reasons. They must remain separate internally so invalid payloads are never retried as Transport failures, while the public API should expose one predictable failure-mapping path.

## Decision

Each immutable `LRequest` owns one memoized, size-limited raw execution. Every data consumer receives a Response clone and runs:

1. automatic decoding or an explicit `as("json" | "text" | "bytes" | "blob" | "formData")` terminal decoder;
2. optional `validate()` parsing, validation, or transformation;
3. unified final `mapError()` handling when either execution or consumption fails.

Direct `await` returns `LResponse<T>` with automatically decoded `data`. The single `as(mode)` terminal selects one decoder or response ownership model and returns a real Promise. Data modes return the same `LResponse` envelope with a forced decoder. `as("response")` returns a retained Response clone and bypasses decoding and validation. `as("stream")` selects the separate live single-owner path defined by the v0.3 RFC.

Schemas may be functions, objects with `parse(value)`, or objects with `validate(value)`. They may return transformed values, booleans, or value/issues result objects. Schema failures become `HttpSchemaError` unless already represented by that type. A transformed Schema output also drives the terminal TypeScript return type; fixed decoder types are used only when no Schema is configured.

Explicit text, bytes, Blob, and FormData decoders preserve their fixed return types for bodyless responses by returning the corresponding empty value. Binary decoding uses `Uint8Array` for both automatic and explicit consumption. Buffered execution enforces the actual received-byte limit rather than trusting `Content-Length`.

## Consequences

- the common JSON path has no terminal decoder ceremony and always retains HTTP context;
- invalid data is never retried as a network failure;
- one error mapper can convert Transport, status, decoding, and schema failures;
- multiple consumers remain isolated through Response clones;
- schema output drives TypeScript inference;
- true streaming remains a separate explicit execution mode because it cannot preserve the buffered multi-consumer invariant.
