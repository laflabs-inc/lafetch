# RFC: response consumption pipeline

Status: accepted and implemented, except consumption telemetry.

## Motivation

HTTP execution, response decoding, and application schema validation fail for different reasons. Treating all of them as execution failures would make retry and error mapping unsafe.

## Decision

The request builder owns one memoized raw execution. Each consumer receives a Response clone and runs:

1. explicit or automatic decoding;
2. optional schema parsing, validation, or transformation;
3. optional consumption-error mapping.

Execution `.mapError()` is completed before this pipeline. `.mapDecodeError()` only observes failures from response consumption. `.raw()` bypasses the entire pipeline.

Schemas may be a function, an object with `parse(value)`, or an object with `validate(value)`. A schema can return a transformed value, `true` to retain the decoded value, `false` to reject it, or a value/issues result object. Schema failures become `HttpSchemaError` unless already represented by that type.

## Consequences

- Invalid data is never retried as a transport failure.
- Multiple consumers remain isolated.
- Schema output can drive TypeScript inference.
- Consumption telemetry needs a separate event family and remains a follow-up decision.
