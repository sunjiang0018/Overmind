/** Engine objects use IDs/names; application wrappers may expose their own stable reference. */
export function getRoomObjectRef(object: {id?: string; name?: string; ref?: string; pos: ProtoPos}): string {
	return object.ref ?? (object.id || object.name || '');
}

export function getTargetedBy(object: RoomObject | {ref: string; pos: ProtoPos; targetedBy: string[]}): string[] {
	if ('targetedBy' in object) return object.targetedBy || [];
	return Overmind.cache.targets[getRoomObjectRef(object)] || [];
}

export function roomObjectSerialize(object: RoomObject): ProtoRoomObject {
	return {
		pos: {x: object.pos.x, y: object.pos.y, roomName: object.pos.roomName},
		ref: getRoomObjectRef(object),
	};
}
