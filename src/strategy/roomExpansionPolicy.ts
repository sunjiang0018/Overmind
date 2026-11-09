/** Explicit user exclusions apply to outpost selection and owned-room expansion, not scouting. */
export function isRoomExpansionBlocked(roomName: string): boolean {
  return (
    Memory.rooms[roomName]?.expansionDisabled === true ||
    Game.time < (Memory.rooms[roomName]?.expansionDisabledUntil ?? 0) ||
    Game.flags?.[roomName + "-Block"] != null
  );
}
