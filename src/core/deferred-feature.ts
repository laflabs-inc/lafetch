import { HttpFeatureError } from "./errors.js";
import type { RequestFeature } from "./types.js";

const loadFeature = Symbol("lafetch.loadFeature");

export interface ConfiguredFeature extends RequestFeature {
  readonly [loadFeature]?: () => Promise<RequestFeature>;
}

export function deferredFeature(
  descriptor: RequestFeature,
  load: () => Promise<RequestFeature>,
): ConfiguredFeature {
  return {
    ...descriptor,
    [loadFeature]: load,
  };
}

export function featureLoader(
  feature: ConfiguredFeature,
): (() => Promise<RequestFeature>) | undefined {
  return feature[loadFeature];
}

export async function loadDeferredFeatures(
  features: readonly ConfiguredFeature[],
): Promise<readonly RequestFeature[]> {
  return Object.freeze(await Promise.all(features.map(async (feature) => {
    const load = featureLoader(feature);
    if (!load) return feature;
    try {
      const loaded = await load();
      return Object.freeze({
        name: feature.name,
        ...(feature.capabilities !== undefined ? { capabilities: feature.capabilities } : {}),
        ...(feature.ordering !== undefined ? { ordering: feature.ordering } : {}),
        ...(loaded.hooks !== undefined ? { hooks: Object.freeze({ ...loaded.hooks }) } : {}),
      });
    } catch (cause) {
      throw new HttpFeatureError(feature.name, "load", { cause });
    }
  })));
}
