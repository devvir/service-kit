import type { Service } from '..';
import type { ProviderType } from '../providers/types';

export function registerLogging(service: Service): void {
  service.on('created', (svc: Service) => {
    svc.logger.info({ name: svc.spec().name, plugins: svc.plugins() }, '[service-kit] service created');
  });

  service.on('started', (svc: Service) => {
    svc.logger.info('[service-kit] service started');
  });

  service.on('complete', (svc: Service) => {
    svc.logger.info('[service-kit] run function complete');
  });

  service.on('shutdown', (svc: Service, signal: string) => {
    svc.logger.info({ signal }, '[service-kit] shutdown initiated');
  });

  service.on('shutdownComplete', (svc: Service, signal: string) => {
    svc.logger.info({ signal }, '[service-kit] shutdown complete');
  });

  service.on('providerConnected', (svc: Service, type: ProviderType, name: string) => {
    svc.logger.info({ type, name }, '[service-kit] provider connected');
  });

  service.on('providerDisconnected', (svc: Service, type: ProviderType, name: string) => {
    svc.logger.info({ type, name }, '[service-kit] provider disconnected');
  });
}
