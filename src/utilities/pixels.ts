/** Spend a full bucket only after the colony has completed its normal tick. */
export function generatePixelIfFull(): void {
	if (typeof Game.cpu.generatePixel != 'function' || Game.cpu.bucket < PIXEL_CPU_COST) return;
	if (Game.cpu.generatePixel() == OK) {
		Memory.stats.persistent.lastPixelTick = Game.time;
	}
}
