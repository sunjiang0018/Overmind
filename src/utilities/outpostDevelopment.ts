export const developmentPositionKey = (p: ProtoPos): string => `${p.roomName}:${p.x}:${p.y}`;

export function orderOutposts(rooms: string[], order?: string[]): string[] {
	if (!order?.length) return rooms;
	const rank = (room: string) => order.includes(room) ? order.indexOf(room) : order.length;
	return rooms.slice().sort((a, b) => rank(a) - rank(b));
}

export function orderDevelopmentRoads<T extends ProtoPos>(positions: T[], priorities?: ProtoPos[]): T[] {
	if (!priorities?.length) return positions;
	const ranks = new Map(priorities.map((p, i) => [developmentPositionKey(p), i]));
	return positions.slice().sort((a, b) => (ranks.get(developmentPositionKey(a)) ?? priorities.length)
		- (ranks.get(developmentPositionKey(b)) ?? priorities.length));
}
