// Types for the parts of simulation/world/plugins.mjs that the TypeScript code uses.

/** One wider-world plug-in (economy, suppliers, supplier side ...). */
export interface WorldPlugin {
  name: string;
  [k: string]: unknown;
}

export function worldPlugins(o: {products: unknown[]}): WorldPlugin[];
