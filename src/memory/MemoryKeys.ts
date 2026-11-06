// Persistent Memory keys. Keep these values stable so existing saved data remains readable.

export const enum MEM {
  TICK = "T",
  EXPIRATION = "X",
  COLONY = "C",
  OVERLORD = "O",
  DISTANCE = "D",
  STATS = "S",
}

export const enum MEM_DISTANCE {
  UNWEIGHTED = "u",
  WEIGHTED = "w",
}

export const enum RMEM {
  AVOID = "a",
  SOURCES = "s",
  CONTROLLER = "c",
  MINERAL = "m",
  SKLAIRS = "k",
  EXPANSION_DATA = "e",
  INVASION_DATA = "v",
  HARVEST = "h",
  // CASUALTIES           = 'd',
  SAFETY = "f",
  PREV_POSITIONS = "pp",
  // CREEPS_IN_ROOM       = 'cr',
  IMPORTANT_STRUCTURES = "i",
  PORTALS = "pr",
  ROOM_STATUS = "rs",
  CREEP_INFO = "ci",
}

export const enum RMEM_STRUCTS {
  TOWERS = "t",
  SPAWNS = "sp",
  STORAGE = "s",
  TERMINAL = "e",
  WALLS = "w",
  RAMPARTS = "r",
}

export const enum RMEM_INVASION {
  HARVESTED = "h",
  LAST_SEEN = "l",
}

export const enum RMEM_CTRL {
  LEVEL = "l",
  OWNER = "o",
  RESERVATION = "r",
  RES_USERNAME = "u",
  RES_TICKSTOEND = "t",
  SAFEMODE = "s",
  SAFEMODE_AVAILABLE = "sa",
  SAFEMODE_COOLDOWN = "sc",
  PROGRESS = "p",
  PROGRESS_TOTAL = "pt",
}

export const enum RMEM_MNRL {
  MINERALTYPE = "t",
  DENSITY = "d",
}

export const enum MEM_AVGS {
  AMOUNT = "a",
  AVG1K = "k",
  AVG10K = "D",
  AVG100K = "H",
  AVG1M = "M",
}

export const enum RMEM_ROOM_STATUS {
  normal = "nm",
  closed = "cl",
  novice = "nv",
  respawn = "re",
}

export const enum RMEM_EXPANSION_DATA {
  SCORE = "s",
  BUNKER_ANCHOR = "a",
  OUTPOSTS = "o",
}

export const enum RMEM_SAFETY {
  THREAT_LEVEL = "t",
  SAFE_FOR = "s",
  UNSAFE_FOR = "u",
  INVISIBLE_FOR = "v",
  // SAFETY_1K            = 'k',
  // SAFETY_10K           = 'D',
  COMBAT_POTENTIALS = "c",
  NUM_HOSTILES = "nh",
  NUM_BOOSTED_HOSTILES = "nb",
}

export const enum COMBAT_POTENTIALS {
  ATTACK = "a",
  RANGED = "r",
  HEAL = "h",
  DISMANTLE = "d",
}

export const enum RMEM_CREEP_INFO {
  ID = "id",
  COORD = "c",
  X_AVG = "xa",
  Y_AVG = "ya",
  TTL = "ttl",
  ENERGY_COST = "e",
}
