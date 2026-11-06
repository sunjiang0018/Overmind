import {
  MEM,
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
} from "../memory/MemoryKeys";

declare global {
  // Room memory declarations. Most properties stored on room memory are compressed using shortened enum access keys
  // to save memory. Use the corresponding methods in RoomIntel.ts to safely access the memory properties in a
  // human-readable format.

  interface RoomMemory {
    spawnGroup?: any;
    [MEM.EXPIRATION]?: number;
    [MEM.TICK]?: number;
    [RMEM.AVOID]?: boolean;
    [RMEM.ROOM_STATUS]?: RoomStatusCompressed;
    [RMEM.SOURCES]?: SavedSource[];
    [RMEM.CONTROLLER]?: SavedController;
    [RMEM.PORTALS]?: SavedPortal[];
    [RMEM.MINERAL]?: SavedMineral;
    [RMEM.SKLAIRS]?: SavedKeeperLair[];
    [RMEM.IMPORTANT_STRUCTURES]?: {
      // Positions of important structures relevant to sieges
      [RMEM_STRUCTS.STORAGE]: string | undefined;
      [RMEM_STRUCTS.TERMINAL]: string | undefined;
      [RMEM_STRUCTS.TOWERS]: string; // string[];
      [RMEM_STRUCTS.SPAWNS]: string; // string[];
      [RMEM_STRUCTS.WALLS]: string; // string[];
      [RMEM_STRUCTS.RAMPARTS]: string; // string[];
    };
    [RMEM.EXPANSION_DATA]?: SavedExpansionData | 0; // 0 == uninhabitable; RoomIntel.getExpansionData will return false
    [RMEM.INVASION_DATA]?: {
      [RMEM_INVASION.HARVESTED]: number;
      [RMEM_INVASION.LAST_SEEN]: number;
    };
    // [RMEM.HARVEST]?: RollingStats;
    // [RMEM.CASUALTIES]?: {
    // 	cost: RollingStats
    // };
    [RMEM.SAFETY]?: SavedSafetyData; // TODO: deprecate
    [RMEM.PREV_POSITIONS]?: { [packedCreepId: string]: string }; // TODO: deprecate
    // [RMEM.CREEPS_IN_ROOM]?: { [tick: number]: string[] }; // TODO: deprecate
    [RMEM.CREEP_INFOS]?: SavedCreepInfo;
  }

  type RoomStatusCompressed = [RMEM_ROOM_STATUS, number];

  interface RollingStats {
    [MEM_AVGS.AMOUNT]: number;
    [MEM_AVGS.AVG10K]: number;
    [MEM_AVGS.AVG100K]: number;
    [MEM_AVGS.AVG1M]: number;
    [MEM.TICK]: number;
  }

  interface SavedExpansionData {
    [RMEM_EXPANSION_DATA.SCORE]: number;
    [RMEM_EXPANSION_DATA.BUNKER_ANCHOR]: string;
    [RMEM_EXPANSION_DATA.OUTPOSTS]: { [roomName: string]: number };
  }

  interface SavedRoomObject {
    c: string; // packed coordinate
  }

  interface SavedSource extends SavedRoomObject {
    cn?: string;
  }

  interface SavedPortal extends SavedRoomObject {
    dest: string | { shard: string; room: string }; // destination pos name or intershard destination
    [MEM.EXPIRATION]: number; // when portal will decay - set to Game.time + 1 million for undefined decay
  }

  interface SavedController extends SavedRoomObject {
    [RMEM_CTRL.LEVEL]: number | undefined;
    [RMEM_CTRL.OWNER]: string | undefined;
    [RMEM_CTRL.RESERVATION]:
      | {
          [RMEM_CTRL.RES_USERNAME]: string;
          [RMEM_CTRL.RES_TICKSTOEND]: number;
        }
      | undefined;
    [RMEM_CTRL.SAFEMODE]: number | undefined;
    [RMEM_CTRL.SAFEMODE_AVAILABLE]: number;
    [RMEM_CTRL.SAFEMODE_COOLDOWN]: number | undefined;
    [RMEM_CTRL.PROGRESS]: number | undefined;
    [RMEM_CTRL.PROGRESS_TOTAL]: number | undefined;
  }

  interface SavedMineral extends SavedRoomObject {
    [RMEM_MNRL.MINERALTYPE]: MineralConstant;
    [RMEM_MNRL.DENSITY]: number;
  }

  interface SavedKeeperLair extends SavedRoomObject {
    cp?: string;
  }

  interface SavedCombatPotentials {
    [COMBAT_POTENTIALS.ATTACK]: number;
    [COMBAT_POTENTIALS.RANGED]: number;
    [COMBAT_POTENTIALS.HEAL]: number;
    [COMBAT_POTENTIALS.DISMANTLE]?: number;
  }

  interface SavedCreepInfo {
    [RMEM_CREEP_INFO.ID]: string;
    [RMEM_CREEP_INFO.COORD]: string;
    [RMEM_CREEP_INFO.X_AVG]: number;
    [RMEM_CREEP_INFO.Y_AVG]: number;
    [RMEM_CREEP_INFO.TTL]: number;
    [RMEM_CREEP_INFO.ENERGY_COST]: number;
  }

  interface SavedSafetyData {
    [RMEM_SAFETY.THREAT_LEVEL]: number;
    [RMEM_SAFETY.SAFE_FOR]: number;
    [RMEM_SAFETY.UNSAFE_FOR]: number;
    [RMEM_SAFETY.INVISIBLE_FOR]: number;
    // [RMEM_SAFETY.SAFETY_1K]: number;
    // [RMEM_SAFETY.SAFETY_10K]: number;
    [RMEM_SAFETY.COMBAT_POTENTIALS]?: SavedCombatPotentials;
    [RMEM_SAFETY.NUM_HOSTILES]?: number;
    [RMEM_SAFETY.NUM_BOOSTED_HOSTILES]?: number;
  }

  interface SafetyData {
    threatLevel: number;
    safeFor: number;
    unsafeFor: number;
    invisibleFor: number;
    // [RMEM_SAFETY.SAFETY_1K]: number;
    // [RMEM_SAFETY.SAFETY_10K]: number;
    combatPotentials?: SavedCombatPotentials;
    numHostiles?: number;
    numBoostedHostiles?: number;
  }
}
