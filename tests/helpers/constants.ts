import { createRequire } from "node:module";

// The engine constants package has no declarations; VM fixtures also use internal constants.
export const constants: Record<string, any> = createRequire(import.meta.url)(
  "@screeps/common/lib/constants",
);
