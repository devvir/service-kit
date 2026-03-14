import type { ProviderHandler, ProviderType } from './types';

type RegistryEntry = { type: ProviderType; handler: ProviderHandler };

const registry = new Map<string, RegistryEntry>();

export function registerProvider(name: string, type: ProviderType, handler: ProviderHandler): void {
  registry.set(name, { type, handler });
}

export function lookupProvider(name: string): RegistryEntry | undefined {
  return registry.get(name);
}
