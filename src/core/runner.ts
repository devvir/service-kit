import type { ServiceFn } from '..';
import type { Context } from '../types/core';

export default async function runner(serviceFn: ServiceFn, context: Context): Promise<void> {
  console.log(serviceFn, context);
}
