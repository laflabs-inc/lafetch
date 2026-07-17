import { HttpFeatureConflictError } from "./errors.js";
import type { CapabilityMode, RequestFeature } from "./types.js";

interface CapabilityProvider {
  readonly feature: RequestFeature;
  readonly mode: CapabilityMode;
}

export function resolveFeatures(features: readonly RequestFeature[]): readonly RequestFeature[] {
  const byName = new Map<string, { feature: RequestFeature; index: number }>();

  features.forEach((feature, index) => {
    if (!feature.name.trim()) throw new HttpFeatureConflictError("Feature names cannot be empty.");
    if (byName.has(feature.name)) {
      throw new HttpFeatureConflictError(`Feature "${feature.name}" is registered more than once.`);
    }
    byName.set(feature.name, { feature, index });
  });

  const providers = new Map<string, CapabilityProvider[]>();
  for (const feature of features) {
    for (const capability of feature.capabilities?.provides ?? []) {
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

  const edges = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const feature of features) {
    edges.set(feature.name, new Set());
    indegree.set(feature.name, 0);
  }

  const addEdge = (from: string, to: string) => {
    if (!byName.has(from) || !byName.has(to) || from === to) return;
    const targets = edges.get(from)!;
    if (!targets.has(to)) {
      targets.add(to);
      indegree.set(to, (indegree.get(to) ?? 0) + 1);
    }
  };

  for (const feature of features) {
    for (const before of feature.ordering?.before ?? []) addEdge(feature.name, before);
    for (const after of feature.ordering?.after ?? []) addEdge(after, feature.name);
  }

  const ready = [...features]
    .filter((feature) => indegree.get(feature.name) === 0)
    .sort((a, b) => byName.get(a.name)!.index - byName.get(b.name)!.index);
  const sorted: RequestFeature[] = [];

  while (ready.length > 0) {
    const feature = ready.shift()!;
    sorted.push(feature);
    for (const target of edges.get(feature.name) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) {
        ready.push(byName.get(target)!.feature);
        ready.sort((a, b) => byName.get(a.name)!.index - byName.get(b.name)!.index);
      }
    }
  }

  if (sorted.length !== features.length) {
    const cycle = features.filter((feature) => (indegree.get(feature.name) ?? 0) > 0).map((feature) => feature.name);
    throw new HttpFeatureConflictError(`Feature ordering contains a cycle: ${cycle.join(" -> ")}.`);
  }

  return Object.freeze(sorted);
}

