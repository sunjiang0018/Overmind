/** Spend a full bucket only after the colony has completed its normal tick. */
export function generatePixelIfFull(): void {
  if (Memory.settings?.pixelGenerationPaused) return;
  // Keep the CPU reserve until the explicitly ordered raid and its withdrawal finish.
  if (
    Object.values(Memory.flags || {}).some((flag) => {
      const raid = (flag as FlagMemory & { raid?: { phase: string } }).raid;
      return raid && raid.phase !== "complete";
    })
  )
    return;
  if (typeof Game.cpu.generatePixel != "function" || Game.cpu.bucket < PIXEL_CPU_COST) return;
  if (Game.cpu.generatePixel() == OK) {
    Memory.stats.persistent.lastPixelTick = Game.time;
  }
}
