import type { SystemDef, QueryDef, ResourceToken } from './types.js';

/**
 * Define a system. Syntactic sugar for creating a SystemDef.
 */
export function defineSystem(def: {
  name: string;
  query?: QueryDef;
  resources?: { read?: ResourceToken<unknown>[]; write?: ResourceToken<unknown>[] };
  execute: SystemDef['execute'];
}): SystemDef {
  return {
    name: def.name,
    query: def.query,
    resources: def.resources,
    execute: def.execute,
  };
}
