export type JsonKey   = string | symbol;
export type JsonValue =
  | string | number | boolean | null | undefined | symbol
  | JsonValue[]
  | { [k: string | symbol]: JsonValue };
