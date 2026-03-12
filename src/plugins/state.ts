import type { Config, Plugin } from '..';
import { JsonKey } from '../types/shared';

type State = Record<JsonKey, unknown>;

export default {
  name: 'State',

  extends: ({ spec }: Config) => {
    if (spec.state && typeof spec.state !== 'object')
      throw new Error('[State Plugin] Spec `state` must be an object');

    const state: State = spec.state ??= {};

    return {
      state: (key?: JsonKey) => key ? state[key] : { ...state },
      setState: (key: JsonKey, value: unknown) => (state[key] = value),

      increment: (key: JsonKey) => {
        ensureKeyIsNumeric(state, key);
        state[key] = state[key] ? (state[key] as number) + 1 : 1;
      },

      decrement: (key: JsonKey) => {
        ensureKeyIsNumeric(state, key);
        state[key] = state[key] ? (state[key] as number) - 1 : -1;
      },
    }
  },
} as Plugin;

const ensureKeyIsNumeric = (state: State, key: JsonKey): void => {
  if (state[key] !== undefined && typeof state[key] !== 'number') {
    throw new Error(`[State Plugin] State "${String(key)}" must be a number to use increment/decrement`);
  }
}

//--- Extend Service interface ------------------------------------------------

declare module '..' {
  interface Service {
    state(key?: JsonKey): unknown | Record<JsonKey, unknown>;
    setState(key: JsonKey, value: unknown): void;
    increment(key: JsonKey): void;
    decrement(key: JsonKey): void;
  }

  interface Spec {
    state?: State;
  }
}