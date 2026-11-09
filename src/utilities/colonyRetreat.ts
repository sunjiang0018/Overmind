import { getRoomDangerousHostiles } from "../game/Room";
import type { Zerg } from "../zerg/Zerg";

/** Only explicitly recalled units use this path; ordinary workers retain their normal flee logic. */
export function runColonyRetreat(worker: Zerg): boolean {
  const home = worker.memory.colonyRetreatRoom;
  if (!home) return false;
  if (worker.spawning) return true;
  if (worker.safelyInRoom(home)) {
    delete worker.memory.colonyRetreatRoom;
    delete worker.memory.colonyRetreatThreatKey;
    delete worker.memory._go;
    worker.task = null;
    return false;
  }
  worker.task = null;
  const threats = getRoomDangerousHostiles(worker.room);
  const key = `${worker.room.name}:${threats
    .map((h) => `${h.pos.x},${h.pos.y}`)
    .sort()
    .join(";")}`;
  if (worker.memory.colonyRetreatThreatKey !== key) {
    delete worker.memory._go;
    worker.memory.colonyRetreatThreatKey = key;
  }
  if (threats.some((h) => worker.pos.getRangeTo(h) <= 5)) {
    worker.flee(threats, {}, { fleeRange: 6, pathOpts: { fleeRange: 6 } });
    return true;
  }
  const obstacles: RoomPosition[] = [];
  for (const hostile of threats) {
    for (let x = Math.max(0, hostile.pos.x - 5); x <= Math.min(49, hostile.pos.x + 5); x++) {
      for (let y = Math.max(0, hostile.pos.y - 5); y <= Math.min(49, hostile.pos.y + 5); y++) {
        obstacles.push(new RoomPosition(x, y, worker.room.name));
      }
    }
  }
  worker.goToRoom(home, { pathOpts: { obstacles, avoidSK: true } });
  return true;
}
