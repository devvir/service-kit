import type { Service, ServiceConfig } from '..';
import type { ProvidersAPI } from '../providers/types';

export const SK_CONFIG    = Symbol('SK_CONFIG');
export const SK_STATE     = Symbol('SK_STATE');
export const SK_PROVIDERS = Symbol('SK_PROVIDERS');

const services = new Map<string, Service>();

export function add(service: Service): void {
  const name = service.spec().name;

  if (! name)
    throw new Error('[registry] Cannot register a service without a name in spec');

  if (services.has(name))
    throw new Error(`[registry] Service "${name}" is already registered`);

  services.set(name, service);
}

export function has(name: string): boolean {
  return services.has(name);
}

export function get(name: string, member: typeof SK_CONFIG):    ServiceConfig;
export function get(name: string, member: typeof SK_STATE):     unknown;
export function get(name: string, member: typeof SK_PROVIDERS): ProvidersAPI;
export function get(name: string):                              Service;
export function get(name: string, member?: symbol): Service | ServiceConfig | unknown | ProvidersAPI {
  const service = services.get(name);

  if (! service) {
    throw new Error(`[registry] Service "${name}" is not registered`);
  }

  if (member === SK_CONFIG)
    return service.config() as ServiceConfig;

  if (member === SK_STATE)
    return service.state?.();

  if (member === SK_PROVIDERS)
    return service.providers as ProvidersAPI;

  return service;
}

/** Remove all registered services — for use in tests only. */
export function clear(): void {
  services.clear();
}
