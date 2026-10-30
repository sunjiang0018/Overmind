import {createTickCache} from './cache';

export const getTerminalState = createTickCache((terminal: StructureTerminal) => ({
	notReady: false,
	hasReceived: undefined as boolean | undefined,
}));
