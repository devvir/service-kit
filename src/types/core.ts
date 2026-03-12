import type { Config, Spec, Bindings, Plugin } from '.';

export interface Context {
  defaults: Config;
  spec:     Spec[];
  bindings: Bindings[];
  plugins:  Plugin[];
}
