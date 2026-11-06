import { createRequire } from "node:module";

// Screeps supplies Lodash 3; emulate the server's global in bundle tests.
const require = createRequire(import.meta.url);
export default createRequire(require.resolve("@screeps/common"))("lodash");
