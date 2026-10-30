import {getTerminalState} from './terminalState';

/** Execute the current tick's market API with its receiver intact, then record the intent. */
export function marketDeal(orderId: string, amount: number, targetRoomName?: string): ScreepsReturnCode {
	const response = Game.market.deal(orderId, amount, targetRoomName);
	if (response === OK && targetRoomName) {
		const terminal = Game.rooms[targetRoomName]?.terminal;
		if (terminal?.my) getTerminalState(terminal).notReady = true;
	}
	return response;
}
