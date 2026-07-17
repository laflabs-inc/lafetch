import { HttpError, HttpFeatureError } from "./errors.js";
import type {
  AttemptErrorContext,
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

  async emit(event: RequestEvent): Promise<void> {
    for (const feature of this.features) {
      if (!feature.hooks?.onEvent) continue;
      await this.#run(feature, "onEvent", () =>
        feature.hooks!.onEvent!({ ...this.#context(feature), event }),
      );
    }
  }

  async prepare(draft: MutableRequestDraft, signal: AbortSignal): Promise<void> {
    for (const feature of this.features) {
      if (!feature.hooks?.prepare) continue;
      await this.#run(feature, "prepare", () =>
        feature.hooks!.prepare!({ ...this.#context(feature), draft, signal }),
      );
    }
  }

  async beforeAttempt(draft: MutableRequestDraft, attempt: number, signal: AbortSignal): Promise<void> {
    for (const feature of this.features) {
      if (!feature.hooks?.beforeAttempt) continue;
      await this.#run(feature, "beforeAttempt", () =>
        feature.hooks!.beforeAttempt!({ ...this.#context(feature), draft, attempt, signal }),
      );
    }
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
    for (const feature of this.features) {
      if (!feature.hooks?.onAttemptError) continue;
      const context: AttemptErrorContext = {
        ...this.#context(feature),
        ...(input.request !== undefined ? { request: input.request } : {}),
        error: input.error,
        attempt: input.attempt,
        willRetry: input.willRetry,
        ...(input.retryDelayMs !== undefined ? { retryDelayMs: input.retryDelayMs } : {}),
      };
      await this.#run(feature, "onAttemptError", () => feature.hooks!.onAttemptError!(context));
    }
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
        await this.#run(feature, "finalize", () =>
          feature.hooks!.finalize!({
            ...this.#context(feature),
            ...(input.request !== undefined ? { request: input.request } : {}),
            ...(input.response !== undefined ? { response: input.response } : {}),
            ...(input.error !== undefined ? { error: input.error } : {}),
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
