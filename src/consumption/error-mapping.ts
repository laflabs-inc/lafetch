export interface ConsumptionErrorContext {
  readonly request: Request;
  readonly response: Response;
}

export type ConsumptionErrorMapper = (
  error: Error,
  context: ConsumptionErrorContext,
) => Error | void | Promise<Error | void>;

export async function mapConsumptionError(
  mapper: ConsumptionErrorMapper | undefined,
  error: unknown,
  context: ConsumptionErrorContext,
): Promise<never> {
  const current = error instanceof Error ? error : new Error("Response consumption failed.", { cause: error });
  if (!mapper) throw current;
  const mapped = await mapper(current, context);
  if (mapped !== undefined && !(mapped instanceof Error)) {
    throw new TypeError("mapDecodeError() must return an Error or undefined.");
  }
  throw mapped ?? current;
}
