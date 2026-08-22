import { HttpError, HttpFeatureError } from "./errors.js";
import type {
  FeatureBaseContext,
  FeatureState,
  MutableRequestDraft,
  RequestEvent,
  RequestFeature,
} from "./types.js";

export interface InterceptedResponse {
  readonly response: Response;
  readonly source: string;
}

export interface AttemptErrorInput {
  readonly request?: Request;
  readonly error: unknown;
  readonly attempt: number;
  readonly willRetry: boolean;
  readonly retryDelayMs?: number;
}

export interface FinalizeInput {
  readonly request?: Request;
  readonly response?: Response;
  readonly error?: unknown;
  readonly attempts: number;
  readonly source?: string;
}

export class FeatureRuntime {
  readonly metadata = new Map<string, unknown>();
  readonly #states = new Map<string, FeatureState>();

  constructor(
    readonly features: readonly RequestFeature[],
    readonly requestId: string,
  ) {
    for (const feature of features) this.#states.set(feature.name, new Map());
  }

  #context(feature: RequestFeature): FeatureBaseContext {
    return {
      requestId: this.requestId,
      metadata: this.metadata,
      state: this.#states.get(feature.name)!,
    };
  }

  async #run<T>(feature: RequestFeature, hook: string, invoke: () => T | Promise<T>): Promise<T> {
    try {
      return await invoke();
    } catch (cause) {
      if (cause instanceof HttpError) throw cause;
      throw new HttpFeatureError(feature.name, hook, { cause });
    }
  }

  async #dispatch(
    hook: "onEvent" | "prepare" | "beforeAttempt" | "onAttemptError",
    fields: object,
  ): Promise<void> {
    for (const feature of this.features) {
      const hooks = feature.hooks;
      if (!hooks?.[hook]) continue;
      await this.#run(feature, hook, () =>
        (hooks[hook] as (context: FeatureBaseContext & object) => void | Promise<void>)(
          { ...this.#context(feature), ...fields },
        ),
      );
    }
  }

  async emit(event: RequestEvent): Promise<void> {
    await this.#dispatch("onEvent", { event });
  }

  async prepare(draft: MutableRequestDraft, signal: AbortSignal): Promise<void> {
    await this.#dispatch("prepare", { draft, signal });
  }

  async beforeAttempt(draft: MutableRequestDraft, attempt: number, signal: AbortSignal): Promise<void> {
    await this.#dispatch("beforeAttempt", { draft, attempt, signal });
  }

  async intercept(request: Request, attempt: number, signal: AbortSignal): Promise<InterceptedResponse | undefined> {
    for (const feature of this.features) {
      if (!feature.hooks?.intercept) continue;
      const response = await this.#run(feature, "intercept", () =>
        feature.hooks!.intercept!({ ...this.#context(feature), request, attempt, signal }),
      );
      if (response === undefined) continue;
      if (!(response instanceof Response)) {
        throw new HttpFeatureError(feature.name, "intercept", {
          cause: new TypeError("intercept() must return a Response or undefined."),
        });
      }
      return { response, source: `feature:${feature.name}` };
    }
    return undefined;
  }

  async afterResponse(request: Request, response: Response, attempt: number, source: string): Promise<Response> {
    let current = response;
    for (const feature of this.features) {
      if (!feature.hooks?.afterResponse) continue;
      const replacement = await this.#run(feature, "afterResponse", () =>
        feature.hooks!.afterResponse!({
          ...this.#context(feature),
          request,
          response: current,
          attempt,
          source,
        }),
      );
      if (replacement === undefined) continue;
      if (!(replacement instanceof Response)) {
        throw new HttpFeatureError(feature.name, "afterResponse", {
          cause: new TypeError("afterResponse() must return a Response or undefined."),
        });
      }
      current = replacement;
    }
    return current;
  }

  async onAttemptError(input: AttemptErrorInput): Promise<void> {
    await this.#dispatch("onAttemptError", {
      ...(input.request !== undefined ? { request: input.request } : {}),
      error: input.error,
      attempt: input.attempt,
      willRetry: input.willRetry,
      ...(input.retryDelayMs !== undefined ? { retryDelayMs: input.retryDelayMs } : {}),
    });
  }

  async mapError(error: Error, attempts: number, request?: Request): Promise<Error> {
    let current = error;
    for (const feature of [...this.features].reverse()) {
      if (!feature.hooks?.mapError) continue;
      const replacement = await this.#run(feature, "mapError", () =>
        feature.hooks!.mapError!({
          ...this.#context(feature),
          ...(request !== undefined ? { request } : {}),
          error: current,
          attempts,
        }),
      );
      if (replacement === undefined) continue;
      if (!(replacement instanceof Error)) {
        throw new HttpFeatureError(feature.name, "mapError", {
          cause: new TypeError("mapError() must return an Error or undefined."),
        });
      }
      current = replacement;
    }
    return current;
  }

  async finalize(input: FinalizeInput): Promise<void> {
    let firstError: unknown;
    for (const feature of [...this.features].reverse()) {
      if (!feature.hooks?.finalize) continue;
      try {
        const effectiveError = firstError ?? input.error;
        await this.#run(feature, "finalize", () =>
          feature.hooks!.finalize!({
            ...this.#context(feature),
            ...(input.request !== undefined ? { request: input.request } : {}),
            ...(input.response !== undefined ? { response: input.response.clone() } : {}),
            ...(effectiveError !== undefined ? { error: effectiveError } : {}),
            attempts: input.attempts,
            ...(input.source !== undefined ? { source: input.source } : {}),
          }),
        );
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) throw firstError;
  }
}
