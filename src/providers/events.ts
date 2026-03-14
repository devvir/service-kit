import type { Service } from '..';
import type { ProviderType } from './types';

export function registerEventDispatch(service: Service): void {
  service.on('providerConnected',    (_svc: Service, type: ProviderType, name: string) => service.emit(`${name}Connected`,    type, name));
  service.on('providerDisconnected', (_svc: Service, type: ProviderType, name: string) => service.emit(`${name}Disconnected`, type, name));
}
