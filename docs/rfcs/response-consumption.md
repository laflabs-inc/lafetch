# RFC: response consumption pipeline

Status: superseded by and incorporated into the v0.2.1 Progressive Builder API.

## Motivation

HTTP execution, response decoding, and application schema validation fail for different reasons. They must remain separate internally so invalid payloads are never retried as Transport failures, while the public API should expose one predictable failure-mapping path.

## Decision

Each immutable request builder owns one memoized raw execution. Every data consumer receives a Response clone and runs:

1. automatic decoding or an explicit `asJson()`, `asText()` and related terminal decoder;
2. optional `validate()` parsing, validation, or transformation;
3. unified final `mapError()` handling when either execution or consumption fails.

Direct `await` returns automatically decoded data. Explicit `as*()` terminals select one decoder and return a real Promise. `asResponse()` returns automatically decoded data with HTTP and execution metadata. `asRaw()` returns a Response clone and bypasses decoding and validation.

Schemas may be functions, objects with `parse(value)`, or objects with `validate(value)`. They may return transformed values, booleans, or value/issues result objects. Schema failures become `HttpSchemaError` unless already represented by that type.

## Consequences

- the common JSON path has no terminal decoder ceremony;
- invalid data is never retried as a network failure;
- one error mapper can convert Transport, status, decoding, and schema failures;
- multiple consumers remain isolated through Response clones;
- schema output drives TypeScript inference;
- true streaming remains a separate explicit execution mode because it cannot preserve the buffered multi-consumer invariant.
