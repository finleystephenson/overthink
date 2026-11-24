// Types for the parts of simulation/world/supplier-side.mjs that the TypeScript code uses.

/** The people at one supplier: who writes, and the addresses that reach them. */
export interface SupplierPeople {
  id: string;
  name: string;
  contact: {name: string; first?: string; from?: string};
  tone: string;
  from: {name: string; address: string};
  /** The contact's own address, then the sales desk (orders@), then the accounts desk (accounts@). */
  addresses: [string, string, string];
}

/** The contact person and addresses for a supplier record, or null for a supplier with none on file. */
export function supplierPeople(sup: {id: string; name: string} | null | undefined): SupplierPeople | null;
