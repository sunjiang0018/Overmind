import { createTickCache } from "./cache";

export const getTerminalState = createTickCache((_terminal: StructureTerminal) => ({
  notReady: false,
  hasReceived: undefined as boolean | undefined,
}));
