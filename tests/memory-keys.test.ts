import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  MEM,
  MEM_DISTANCE,
  RMEM,
  RMEM_STRUCTS,
  RMEM_INVASION,
  RMEM_CTRL,
  RMEM_MNRL,
  MEM_AVGS,
  RMEM_ROOM_STATUS,
  RMEM_EXPANSION_DATA,
  RMEM_SAFETY,
  COMBAT_POTENTIALS,
  RMEM_CREEP_INFO,
} from "../src/memory/MemoryKeys";

// These literals are the persisted format from before the enums became module exports.
test("memory key enums preserve the persisted Memory format", () => {
  assert.equal(MEM.TICK, "T", "MEM.TICK");
  assert.equal(MEM.EXPIRATION, "X", "MEM.EXPIRATION");
  assert.equal(MEM.COLONY, "C", "MEM.COLONY");
  assert.equal(MEM.OVERLORD, "O", "MEM.OVERLORD");
  assert.equal(MEM.DISTANCE, "D", "MEM.DISTANCE");
  assert.equal(MEM.STATS, "S", "MEM.STATS");

  assert.equal(MEM_DISTANCE.UNWEIGHTED, "u", "MEM_DISTANCE.UNWEIGHTED");
  assert.equal(MEM_DISTANCE.WEIGHTED, "w", "MEM_DISTANCE.WEIGHTED");

  assert.equal(RMEM.AVOID, "a", "RMEM.AVOID");
  assert.equal(RMEM.SOURCES, "s", "RMEM.SOURCES");
  assert.equal(RMEM.CONTROLLER, "c", "RMEM.CONTROLLER");
  assert.equal(RMEM.MINERAL, "m", "RMEM.MINERAL");
  assert.equal(RMEM.SKLAIRS, "k", "RMEM.SKLAIRS");
  assert.equal(RMEM.EXPANSION_DATA, "e", "RMEM.EXPANSION_DATA");
  assert.equal(RMEM.INVASION_DATA, "v", "RMEM.INVASION_DATA");
  assert.equal(RMEM.HARVEST, "h", "RMEM.HARVEST");
  assert.equal(RMEM.SAFETY, "f", "RMEM.SAFETY");
  assert.equal(RMEM.PREV_POSITIONS, "pp", "RMEM.PREV_POSITIONS");
  assert.equal(RMEM.IMPORTANT_STRUCTURES, "i", "RMEM.IMPORTANT_STRUCTURES");
  assert.equal(RMEM.PORTALS, "pr", "RMEM.PORTALS");
  assert.equal(RMEM.ROOM_STATUS, "rs", "RMEM.ROOM_STATUS");
  assert.equal(RMEM.CREEP_INFO, "ci", "RMEM.CREEP_INFO");

  assert.equal(RMEM_STRUCTS.TOWERS, "t", "RMEM_STRUCTS.TOWERS");
  assert.equal(RMEM_STRUCTS.SPAWNS, "sp", "RMEM_STRUCTS.SPAWNS");
  assert.equal(RMEM_STRUCTS.STORAGE, "s", "RMEM_STRUCTS.STORAGE");
  assert.equal(RMEM_STRUCTS.TERMINAL, "e", "RMEM_STRUCTS.TERMINAL");
  assert.equal(RMEM_STRUCTS.WALLS, "w", "RMEM_STRUCTS.WALLS");
  assert.equal(RMEM_STRUCTS.RAMPARTS, "r", "RMEM_STRUCTS.RAMPARTS");

  assert.equal(RMEM_INVASION.HARVESTED, "h", "RMEM_INVASION.HARVESTED");
  assert.equal(RMEM_INVASION.LAST_SEEN, "l", "RMEM_INVASION.LAST_SEEN");

  assert.equal(RMEM_CTRL.LEVEL, "l", "RMEM_CTRL.LEVEL");
  assert.equal(RMEM_CTRL.OWNER, "o", "RMEM_CTRL.OWNER");
  assert.equal(RMEM_CTRL.RESERVATION, "r", "RMEM_CTRL.RESERVATION");
  assert.equal(RMEM_CTRL.RES_USERNAME, "u", "RMEM_CTRL.RES_USERNAME");
  assert.equal(RMEM_CTRL.RES_TICKSTOEND, "t", "RMEM_CTRL.RES_TICKSTOEND");
  assert.equal(RMEM_CTRL.SAFEMODE, "s", "RMEM_CTRL.SAFEMODE");
  assert.equal(RMEM_CTRL.SAFEMODE_AVAILABLE, "sa", "RMEM_CTRL.SAFEMODE_AVAILABLE");
  assert.equal(RMEM_CTRL.SAFEMODE_COOLDOWN, "sc", "RMEM_CTRL.SAFEMODE_COOLDOWN");
  assert.equal(RMEM_CTRL.PROGRESS, "p", "RMEM_CTRL.PROGRESS");
  assert.equal(RMEM_CTRL.PROGRESS_TOTAL, "pt", "RMEM_CTRL.PROGRESS_TOTAL");

  assert.equal(RMEM_MNRL.MINERALTYPE, "t", "RMEM_MNRL.MINERALTYPE");
  assert.equal(RMEM_MNRL.DENSITY, "d", "RMEM_MNRL.DENSITY");

  assert.equal(MEM_AVGS.AMOUNT, "a", "MEM_AVGS.AMOUNT");
  assert.equal(MEM_AVGS.AVG1K, "k", "MEM_AVGS.AVG1K");
  assert.equal(MEM_AVGS.AVG10K, "D", "MEM_AVGS.AVG10K");
  assert.equal(MEM_AVGS.AVG100K, "H", "MEM_AVGS.AVG100K");
  assert.equal(MEM_AVGS.AVG1M, "M", "MEM_AVGS.AVG1M");

  assert.equal(RMEM_ROOM_STATUS.normal, "nm", "RMEM_ROOM_STATUS.normal");
  assert.equal(RMEM_ROOM_STATUS.closed, "cl", "RMEM_ROOM_STATUS.closed");
  assert.equal(RMEM_ROOM_STATUS.novice, "nv", "RMEM_ROOM_STATUS.novice");
  assert.equal(RMEM_ROOM_STATUS.respawn, "re", "RMEM_ROOM_STATUS.respawn");

  assert.equal(RMEM_EXPANSION_DATA.SCORE, "s", "RMEM_EXPANSION_DATA.SCORE");
  assert.equal(RMEM_EXPANSION_DATA.BUNKER_ANCHOR, "a", "RMEM_EXPANSION_DATA.BUNKER_ANCHOR");
  assert.equal(RMEM_EXPANSION_DATA.OUTPOSTS, "o", "RMEM_EXPANSION_DATA.OUTPOSTS");

  assert.equal(RMEM_SAFETY.THREAT_LEVEL, "t", "RMEM_SAFETY.THREAT_LEVEL");
  assert.equal(RMEM_SAFETY.SAFE_FOR, "s", "RMEM_SAFETY.SAFE_FOR");
  assert.equal(RMEM_SAFETY.UNSAFE_FOR, "u", "RMEM_SAFETY.UNSAFE_FOR");
  assert.equal(RMEM_SAFETY.INVISIBLE_FOR, "v", "RMEM_SAFETY.INVISIBLE_FOR");
  assert.equal(RMEM_SAFETY.COMBAT_POTENTIALS, "c", "RMEM_SAFETY.COMBAT_POTENTIALS");
  assert.equal(RMEM_SAFETY.NUM_HOSTILES, "nh", "RMEM_SAFETY.NUM_HOSTILES");
  assert.equal(RMEM_SAFETY.NUM_BOOSTED_HOSTILES, "nb", "RMEM_SAFETY.NUM_BOOSTED_HOSTILES");

  assert.equal(COMBAT_POTENTIALS.ATTACK, "a", "COMBAT_POTENTIALS.ATTACK");
  assert.equal(COMBAT_POTENTIALS.RANGED, "r", "COMBAT_POTENTIALS.RANGED");
  assert.equal(COMBAT_POTENTIALS.HEAL, "h", "COMBAT_POTENTIALS.HEAL");
  assert.equal(COMBAT_POTENTIALS.DISMANTLE, "d", "COMBAT_POTENTIALS.DISMANTLE");

  assert.equal(RMEM_CREEP_INFO.ID, "id", "RMEM_CREEP_INFO.ID");
  assert.equal(RMEM_CREEP_INFO.COORD, "c", "RMEM_CREEP_INFO.COORD");
  assert.equal(RMEM_CREEP_INFO.X_AVG, "xa", "RMEM_CREEP_INFO.X_AVG");
  assert.equal(RMEM_CREEP_INFO.Y_AVG, "ya", "RMEM_CREEP_INFO.Y_AVG");
  assert.equal(RMEM_CREEP_INFO.TTL, "ttl", "RMEM_CREEP_INFO.TTL");
  assert.equal(RMEM_CREEP_INFO.ENERGY_COST, "e", "RMEM_CREEP_INFO.ENERGY_COST");
});
