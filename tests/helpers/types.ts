// Extracted methods run against deliberately partial game objects in an isolated VM.
// Dynamic exports and globals have the same open shape as node:vm.Context.
export type TestScope = Record<string, any>;
