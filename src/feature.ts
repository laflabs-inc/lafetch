import type { RequestFeature } from "./core/types.js";

/**
 * Preserves literal inference for an advanced request Feature.
 * Official Lafetch policies use dedicated RequestBuilder methods instead.
 */
export function defineFeature<TFeature extends RequestFeature>(feature: TFeature): TFeature {
  return feature;
}

export type {
  AfterResponseContext,
  AttemptErrorContext,
  AttemptErrorEvent,
  AttemptResponseEvent,
  AttemptStartedEvent,
  BeforeAttemptContext,
  CapabilityMode,
  FeatureCapabilities,
  FeatureEventContext,
  FeatureOrdering,
  FeatureState,
  FinalizeContext,
  InterceptContext,
  MapErrorContext,
  MutableRequestDraft,
  PrepareContext,
  ProvidedCapability,
  RequestEvent,
  RequestEventErrorSnapshot,
  RequestEventRequestSnapshot,
  RequestEventResponseSnapshot,
  RequestFailedEvent,
  RequestFeature,
  RequestFeatureHooks,
  RequestStartedEvent,
  RequestSucceededEvent,
} from "./core/types.js";
