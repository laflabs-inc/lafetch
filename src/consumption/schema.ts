import { HttpConfigurationError, HttpSchemaError } from "../core/errors.js";

export type SchemaResult<T> =
  | boolean
  | T
  | { readonly value: T; readonly issues?: never }
  | { readonly value?: never; readonly issues: unknown };

/**
 * Dependency-free structural copy of Standard Schema V1. Validator packages
 * provide this property directly; Lafetch never imports the validator itself.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
      options?: Options | undefined,
    ) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  interface Options {
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }

  type Result<Output> = SuccessResult<Output> | FailureResult;

  interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  interface PathSegment {
    readonly key: PropertyKey;
  }

  interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }
}

export type ResponseSchema<T = unknown> =
  | StandardSchemaV1<unknown, T>
  | ((value: unknown) => SchemaResult<T> | Promise<SchemaResult<T>>)
  | { parse(value: unknown): T | Promise<T> }
  | { validate(value: unknown): SchemaResult<T> | Promise<SchemaResult<T>> };

export type InferSchema<TSchema> =
  TSchema extends {
    readonly "~standard": {
      readonly types?: { readonly output: infer TOutput } | undefined;
    };
  } ? TOutput :
  TSchema extends { parse(value: unknown): infer TResult } ? Awaited<TResult> :
  TSchema extends { validate(value: unknown): infer TResult } ?
    Awaited<TResult> extends { value: infer TValue } ? TValue : unknown :
  TSchema extends (value: unknown) => infer TResult ?
    Awaited<TResult> extends boolean ? unknown : Awaited<TResult> extends { value: infer TValue } ? TValue : Awaited<TResult> :
  unknown;

function snapshotStandardSchema<T>(
  schema: object,
): StandardSchemaV1<unknown, T> | undefined {
  if (!("~standard" in schema)) return undefined;
  const standard = schema["~standard"] as object | null;
  if (
    typeof standard !== "object"
    || standard === null
    || !("version" in standard)
    || standard.version !== 1
    || !("vendor" in standard)
    || typeof standard.vendor !== "string"
    || !("validate" in standard)
    || typeof standard.validate !== "function"
  ) {
    throw new HttpConfigurationError(
      "validate() received an invalid Standard Schema V1 implementation.",
    );
  }
  return Object.freeze({
    "~standard": Object.freeze({
      version: 1,
      vendor: standard.vendor,
      validate: standard.validate.bind(standard),
    }),
  });
}

export function snapshotResponseSchema<T>(schema: ResponseSchema<T>): ResponseSchema<T> {
  if (typeof schema === "function") return schema;
  if (typeof schema !== "object" || schema === null) {
    throw new HttpConfigurationError(
      "validate() requires Standard Schema V1, a function, or an object with parse() or validate().",
    );
  }
  const standard = snapshotStandardSchema<T>(schema);
  if (standard) return standard;
  if ("parse" in schema && typeof schema.parse === "function") {
    return Object.freeze({ parse: schema.parse.bind(schema) });
  }
  if ("validate" in schema && typeof schema.validate === "function") {
    return Object.freeze({ validate: schema.validate.bind(schema) });
  }
  throw new HttpConfigurationError(
    "validate() requires Standard Schema V1, a function, or an object with parse() or validate().",
  );
}

export async function applySchema<T>(schema: ResponseSchema<T>, value: unknown): Promise<T> {
  try {
    const result = typeof schema === "function"
      ? await schema(value)
      : "~standard" in schema
        ? await schema["~standard"].validate(value)
      : "parse" in schema
        ? await schema.parse(value)
        : await schema.validate(value);
    if (result === true) return value as T;
    if (result === false) throw new HttpSchemaError();
    if (result && typeof result === "object" && "issues" in result && result.issues !== undefined) {
      throw new HttpSchemaError(undefined, { issues: result.issues });
    }
    if (result && typeof result === "object" && "value" in result) return result.value as T;
    return result as T;
  } catch (cause) {
    if (cause instanceof HttpSchemaError) throw cause;
    throw new HttpSchemaError(undefined, { cause });
  }
}
