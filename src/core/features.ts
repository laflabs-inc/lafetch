import { HttpFeatureConflictError } from "./errors.js";
import type { CapabilityMode, RequestFeature } from "./types.js";

interface CapabilityProvider {
  readonly feature: RequestFeature;
  readonly mode: CapabilityMode;
}

export function resolveFeatures(features: readonly RequestFeature[]): readonly RequestFeature[] {
  const dependencies = new Map<string, Set<string>>();

  features.forEach((feature) => {
    if (!feature.name.trim()) throw new HttpFeatureConflictError("Feature names cannot be empty.");
    if (dependencies.has(feature.name)) {
      throw new HttpFeatureConflictError(`Feature "${feature.name}" is registered more than once.`);
    }
    dependencies.set(feature.name, new Set());
  });

  const providers = new Map<string, CapabilityProvider[]>();
  for (const feature of features) {
    for (const capability of feature.capabilities?.provides ?? []) {
      if (!capability.name.trim()) {
        throw new HttpFeatureConflictError(`Feature "${feature.name}" provides an empty capability name.`);
      }
      const entries = providers.get(capability.name) ?? [];
      entries.push({ feature, mode: capability.mode ?? "exclusive" });
      providers.set(capability.name, entries);
    }
  }

  for (const [name, entries] of providers) {
    if (entries.length <= 1) continue;
    if (entries.some((entry) => entry.mode === "exclusive")) {
      throw new HttpFeatureConflictError(
        `Capability "${name}" is exclusive but is provided by ${entries.map((entry) => `"${entry.feature.name}"`).join(", ")}.`,
      );
    }
    if (new Set(entries.map((entry) => entry.mode)).size > 1) {
      throw new HttpFeatureConflictError(`Capability "${name}" mixes incompatible provider modes.`);
    }
  }

  for (const feature of features) {
    for (const required of feature.capabilities?.requires ?? []) {
      if (!providers.has(required)) {
        throw new HttpFeatureConflictError(`Feature "${feature.name}" requires capability "${required}".`);
      }
    }
    for (const conflict of feature.capabilities?.conflicts ?? []) {
      if (providers.has(conflict)) {
        throw new HttpFeatureConflictError(`Feature "${feature.name}" conflicts with capability "${conflict}".`);
      }
    }
  }

  const addEdge = (from: string, to: string) => {
    if (from === to) throw new HttpFeatureConflictError(`Feature "${from}" cannot order itself.`);
    if (!dependencies.has(from) || !dependencies.has(to)) {
      const missing = !dependencies.has(from) ? from : to;
      throw new HttpFeatureConflictError(`Feature ordering references unknown Feature "${missing}".`);
    }
    dependencies.get(to)!.add(from);
  };

  for (const feature of features) {
    for (const before of feature.ordering?.before ?? []) addEdge(feature.name, before);
    for (const after of feature.ordering?.after ?? []) addEdge(after, feature.name);
    for (const before of feature.ordering?.optionalBefore ?? []) {
      if (before === feature.name) throw new HttpFeatureConflictError(`Feature "${feature.name}" cannot order itself.`);
      if (dependencies.has(before)) addEdge(feature.name, before);
    }
    for (const after of feature.ordering?.optionalAfter ?? []) {
      if (after === feature.name) throw new HttpFeatureConflictError(`Feature "${feature.name}" cannot order itself.`);
      if (dependencies.has(after)) addEdge(after, feature.name);
    }
  }

  const pending = new Set(dependencies.keys());
  const sorted: RequestFeature[] = [];

  while (pending.size > 0) {
    const feature = features.find(({ name }) =>
      pending.has(name)
      && [...dependencies.get(name)!].every((dependency) => !pending.has(dependency)),
    );
    if (!feature) {
      throw new HttpFeatureConflictError(`Feature ordering contains a cycle: ${[...pending].join(" -> ")}.`);
    }
    sorted.push(feature);
    pending.delete(feature.name);
  }

  return Object.freeze(sorted);
}
