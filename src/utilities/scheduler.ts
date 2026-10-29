/** Stable room-specific phases distribute periodic work across ticks and survive global resets. */
export function isRoomTick(roomName: string, interval: number, phase = 0): boolean {
	let hash = 0;
	for (let i = 0; i < roomName.length; i++) {
		hash = (hash * 31 + roomName.charCodeAt(i)) >>> 0;
	}
	return Game.time % interval == (hash + phase) % interval;
}
