import type { Plugin, Service } from '..';
import type { ProvidersAPI, ProviderSpec, ProviderType } from '../providers/types';
import { validateConfiguredProviders, initConnections } from '../providers/lifecycle';
import { registerEventDispatch } from '../providers/events';

export type { ProviderSpec } from '../providers/types';
export { registerProvider } from '../providers/registry';

export default {
  name: 'Providers',

  init(service: Service): void {
    validateConfiguredProviders(service);
    registerEventDispatch(service);

    const { api, disconnectAll } = initConnections(service);

    service.providers = api;
    service.once('shutdown', disconnectAll);
  },
} as Plugin;

//--- Extend Service, Spec, and Bindings interfaces ---------------------------

declare module '..' {
  interface Service {
    providers: ProvidersAPI;
  }

  interface Spec {
    providers?: Record<string, ProviderSpec>;
  }

  interface Bindings {
    onProviderConnected?:    (service: Service, type: ProviderType, name: string) => void;
    onProviderDisconnected?: (service: Service, type: ProviderType, name: string) => void;
  }
}
