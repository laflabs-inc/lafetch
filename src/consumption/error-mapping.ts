export type RequestErrorPhase = "request" | "response";

export interface RequestErrorContext {
  readonly phase: RequestErrorPhase;
  readonly request?: Request;
  readonly response?: Response;
}

export type RequestErrorMapper = (
  error: Error,
  context: RequestErrorContext,
) => Error | void | Promise<Error | void>;

function toError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("The HTTP request failed with a non-Error value.", { cause: error });
}

export async function mapRequestError(
  mappers: readonly RequestErrorMapper[],
  error: unknown,
  context: RequestErrorContext,
): Promise<never> {
  let current = toError(error);
  for (let index = mappers.length - 1; index >= 0; index -= 1) {
    const mapped = await mappers[index]!(current, context);
    if (mapped !== undefined && !(mapped instanceof Error)) {
      throw new TypeError("mapError() must return an Error or undefined.");
    }
    current = mapped ?? current;
  }
  throw current;
}
