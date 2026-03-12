export type JsonKey   = string | symbol;
export type JsonValue =
  | string | number | boolean | null | undefined | symbol
  | JsonValue[]
  | { [k: string | symbol]: JsonValue };

export type Serializable =
  | string | number | boolean | null
  | Serializable[]
  | { [key: string]: Serializable };

export type Fn = (...args: any[]) => any;
