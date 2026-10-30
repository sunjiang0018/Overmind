export function toPercent(value: number, decimals = 0): string {
	return (value * 100).toFixed(decimals) + '%';
}

export function truncateNumber(value: number, decimals = 0): number {
	const factor = 10 ** decimals;
	return Math.trunc(value.valueOf() * factor) / factor;
}

export function isConstructionSiteWalkable(object: ConstructionSite): boolean {
	return object.structureType == STRUCTURE_ROAD ||
		   object.structureType == STRUCTURE_CONTAINER ||
		   object.structureType == STRUCTURE_RAMPART;
}
