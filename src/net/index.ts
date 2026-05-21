/**
 * The `Net` plugin implementation — `servers` and `clients`.
 *
 * Built-in kinds register themselves via side-effect import.
 */

import './clients/ws';
import './clients/fetch';
import './servers/express';
import './servers/ws';

export { buildNet } from './lifecycle';
