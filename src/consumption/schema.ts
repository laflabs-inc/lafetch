import { HttpSchemaError } from "../core/errors.js";

export type SchemaResult<T> =
  | boolean
  | T
  | { readonly value: T; readonly issues?: never }
  | { readonly value?: never; readonly issues: unknown };

export type ResponseSchema<T = unknown> =
  | ((value: unknown) => SchemaResult<T> | Promise<SchemaResult<T>>)
  | { parse(value: unknown): T | Promise<T> }
  | { validate(value: unknown): SchemaResult<T> | Promise<SchemaResult<T>> };

export type InferSchema<TSchema> =
  TSchema extends { parse(value: unknown): infer TResult } ? Awaited<TResult> :
  TSchema extends { validate(value: unknown): infer TResult } ?
    Awaited<TResult> extends { value: infer TValue } ? TValue : unknown :
  TSchema extends (value: unknown) => infer TResult ?
    Awaited<TResult> extends boolean ? unknown : Awaited<TResult> extends { value: infer TValue } ? TValue : Awaited<TResult> :
  unknown;

export async function applySchema<T>(schema: ResponseSchema<T>, value: unknown): Promise<T> {
  try {
    const result = typeof schema === "function"
      ? await schema(value)
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
