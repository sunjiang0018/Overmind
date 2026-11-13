import type { Colony } from "../Colony";
import { createTickCache } from "../game/cache";
import { getRoomCreeps, getRoomDroppedEnergy, getRoomPlayerHostiles } from "../game/Room";
import { getRoomRamparts } from "../game/RoomStructures";
import { CombatIntel } from "../intel/CombatIntel";
import { MatrixLib } from "../matrix/MatrixLib";
import { BOOSTS_T3 } from "../resources/map_resources";
import type { Zerg } from "../zerg/Zerg";

export const southWallHits = 2_000_000;
export const warningRoom = "E58S44";
export const guardRole = "southGuard";
export const menderRole = "southMender";
export const guardBoost = RESOURCE_UTRIUM_ACID;
export const repairBoost = RESOURCE_LEMERGIUM_HYDRIDE;

export const rangerBoosts = [
  RESOURCE_CATALYZED_KEANIUM_ALKALIDE,
  RESOURCE_KEANIUM_ALKALIDE,
  RESOURCE_KEANIUM_OXIDE,
] as const;

const tierThreeBoosts: ReadonlySet<string> = new Set(BOOSTS_T3);
const contactTimeout = 250;
const holdFrontTicks = 25;
interface SouthContact {
  id?: Id<Creep>;
  name: string;
  room: string;
  seen: number;
  atWestExit?: boolean;
  leftWest?: boolean;
}

export interface SouthWatch {
  tick: number;
  outerSeen?: number;
  innerSeen?: number;
  lastContact?: number;
  contactRoom?: string;
  contactName?: string;
  contacts?: SouthContact[];
  front?: { wall: Id<StructureRampart>; seen: number };
  intercept?: { targets: Id<Creep>[]; until: number; engaged?: boolean };
  restore?: {
    x: number;
    y: number;
    started: number;
    finished?: number;
    target?: Id<StructureRampart>;
  };
}

// A one-shot pursuit of the observed siege pair. The home ranger stays on the ramparts.
// Stop at the adjacent room, leave other players alone, and bring the squad back together.
export function interceptSouthRaid(colony: Colony, squad: Zerg[]): Set<Zerg> {
  const taken = new Set<Zerg>();
  const order = colony.memory.southWatch?.intercept;
  if (!order) return taken;
  const home = colony.room,
    outer = Game.rooms.E58S43;
  // A scout on the far side of the outpost cannot see raiders camping at its entrance.
  // Let it restore vision before deciding the targets have left.
  if (!outer && !order.engaged && Game.time <= order.until) return taken;
  const targets = order.targets.map((id) => Game.getObjectById(id)).filter((e): e is Creep => !!e);
  const otherDanger = (r: Room) =>
    getRoomPlayerHostiles(r).some((e) => isSiegeUnit(e) && !order.targets.includes(e.id));
  const forward =
    outer &&
    !outer.controller?.owner &&
    !outer.find(FIND_HOSTILE_STRUCTURES).some((s) => s.structureType === STRUCTURE_TOWER);
  const combatReady = squad.filter(
    (u) =>
      !u.spawning &&
      u.creep.hits > 0.65 * u.creep.hitsMax &&
      u.creep.body.some(
        (b) =>
          b.hits &&
          (b.boost === RESOURCE_CATALYZED_UTRIUM_ACID ||
            b.boost === RESOURCE_CATALYZED_KEANIUM_ALKALIDE),
      ),
  );
  const admitted =
    Game.time <= order.until &&
    !colony.controller.safeMode &&
    forward &&
    !otherDanger(home) &&
    !otherDanger(outer!) &&
    combatReady.filter((u) => u.creep.getActiveBodyparts(ATTACK)).length >= 2 &&
    combatReady.some((u) => u.creep.getActiveBodyparts(RANGED_ATTACK));
  const nearGate = targets.filter((e) =>
    e.pos.roomName === home.name
      ? e.pos.y >= 46
      : e.pos.roomName === outer?.name && (order.engaged || e.pos.y <= 10),
  );
  if (
    !order.engaged &&
    admitted &&
    nearGate.some((e) => e.pos.roomName === outer!.name) &&
    combatReady.every(
      (u) => u.pos.roomName === home.name && u.pos.y >= 45 && u.pos.getRangeTo(combatReady[0]) <= 5,
    )
  )
    order.engaged = true;
  if (admitted && order.engaged && nearGate.length) {
    const focus = nearGate.sort(
      (a, b) =>
        +(b.getActiveBodyparts(HEAL) > 0) - +(a.getActiveBodyparts(HEAL) > 0) || a.hits - b.hits,
    )[0];
    for (const u of combatReady) {
      const range = u.creep.getActiveBodyparts(ATTACK) ? 1 : 3;
      const canHit = nearGate.find(
        (e) => u.room.name === e.pos.roomName && u.pos.inRangeTo(e, range),
      );
      if (canHit) {
        if (range === 1) u.creep.attack(canHit);
        else u.creep.rangedAttack(canHit);
      }
      if (
        u.room.name !== focus.pos.roomName ||
        !u.pos.inRangeTo(focus, range) ||
        u.pos.y === 0 ||
        u.pos.y === 49
      ) {
        // moveTo within range can return OK on the exit without stepping into the room.
        const onEdge = u.room.name === focus.pos.roomName && (u.pos.y === 0 || u.pos.y === 49);
        const dest = onEdge
          ? u.room.getPositionAt(focus.pos.x, u.pos.y === 0 ? 2 : 47)!
          : focus.pos;
        u.creep.moveTo(dest, {
          range: onEdge || u.room.name !== focus.pos.roomName ? 0 : range,
          maxRooms: 2,
          reusePath: 0,
        });
      }
      u.blockMovement = true;
      taken.add(u);
    }
  } else {
    for (const u of squad)
      if (!u.spawning && (u.room.name !== home.name || u.pos.y >= 48)) {
        if (u.room.name === home.name && u.pos.y === 49) {
          // On the entry tick the engine still sees this creep on the exit. Take an actual
          // inward step; a cached cross-room moveTo here can send it straight back outside.
          const inward = [0, -1, 1]
            .map((dx) => home.getPositionAt(u.pos.x + dx, 48))
            .find(
              (p) =>
                p &&
                Game.map.getRoomTerrain(home.name).get(p.x, p.y) !== TERRAIN_MASK_WALL &&
                !p.lookFor(LOOK_CREEPS).length,
            );
          if (inward) u.creep.move(u.pos.getDirectionTo(inward));
        } else {
          u.creep.moveTo(home.getPositionAt(20, 46)!, {
            range: 1,
            maxRooms: u.room.name === home.name ? 1 : 2,
            reusePath: 0,
          });
        }
        u.blockMovement = true;
        taken.add(u);
      }
    if (!taken.size && (!admitted || (outer && !nearGate.length)))
      delete colony.memory.southWatch!.intercept;
  }
  return taken;
}

export function protectsSouthGate(colony: Colony): boolean {
  return colony.name === "E58S42" && Game.shard?.name === "shard3";
}

export function isSiegeUnit(creep: Creep): boolean {
  return creep.body.some(
    (p) =>
      p.hits > 0 &&
      (p.type === ATTACK ||
        p.type === RANGED_ATTACK ||
        p.type === HEAL ||
        p.type === CLAIM ||
        (p.type === WORK &&
          (!creep.getActiveBodyparts(CARRY) ||
            p.boost === RESOURCE_ZYNTHIUM_HYDRIDE ||
            p.boost === RESOURCE_ZYNTHIUM_ACID ||
            p.boost === RESOURCE_CATALYZED_ZYNTHIUM_ACID))),
  );
}

function trackSouthContacts(watch: SouthWatch, home: string): SouthContact[] {
  // Older memory kept only the latest contact. Let it expire normally after an upgrade.
  let contacts = watch.contacts ?? [];
  if (
    !watch.contacts &&
    watch.lastContact !== undefined &&
    watch.contactName &&
    watch.contactRoom
  ) {
    contacts.push({ name: watch.contactName, room: watch.contactRoom, seen: watch.lastContact });
  }
  contacts = contacts.filter((c) => Game.time - c.seen <= contactTimeout);
  for (const name of [warningRoom, "E58S43", home]) {
    const room = Game.rooms[name];
    if (!room) continue;
    for (const enemy of getRoomPlayerHostiles(room)) {
      const index = contacts.findIndex(
        (c) => c.id === enemy.id || (!c.id && c.name === enemy.name),
      );
      const contact = {
        id: enemy.id,
        name: enemy.name,
        room: name,
        seen: Game.time,
        atWestExit:
          name === warningRoom && enemy.pos.x === 0 && enemy.pos.y > 0 && enemy.pos.y < 49,
      };
      if (index < 0) contacts.push(contact);
      else contacts[index] = contact;
    }
  }
  for (const c of contacts) {
    if (c.room !== warningRoom || c.seen === Game.time || c.leftWest) continue;
    // With continuous vision, disappearing directly from the west exit also confirms departure.
    if (
      (c.atWestExit && c.seen === Game.time - 1 && Game.rooms[warningRoom]) ||
      (Game.rooms.E57S44 && c.id && Game.getObjectById(c.id)?.pos.roomName === "E57S44")
    ) {
      c.leftWest = true;
    }
  }
  return Game.rooms.E58S43 ? contacts.filter((c) => !c.leftWest) : contacts;
}

export function updateSouthWatch(colony: Colony): void {
  const watch = (colony.memory.southWatch ??= { tick: Game.time });
  watch.tick = Game.time;
  if (Game.rooms[warningRoom]) watch.outerSeen = Game.time;
  if (Game.rooms.E58S43) watch.innerSeen = Game.time;
  const contacts = trackSouthContacts(watch, colony.name);
  watch.contacts = contacts;
  const latest = contacts.reduce<SouthContact | undefined>(
    (a, c) => (!a || c.seen >= a.seen ? c : a),
    undefined,
  );
  if (latest) {
    watch.lastContact = latest.seen;
    watch.contactRoom = latest.room;
    watch.contactName = latest.name;
  } else {
    delete watch.lastContact;
    delete watch.contactRoom;
    delete watch.contactName;
  }
}

function volleyAt(colony: Colony, pos: RoomPosition): number {
  let damage = 0;
  for (const tower of colony.towers) {
    if (!tower.my || !tower.isActive() || tower.store.energy < TOWER_ENERGY_COST) continue;
    let shot = CombatIntel.singleTowerDamage(tower.pos.getRangeTo(pos));
    for (const effect of tower.effects ?? []) {
      if (
        effect.ticksRemaining > 0 &&
        (effect.effect === PWR_OPERATE_TOWER || effect.effect === PWR_DISRUPT_TOWER)
      ) {
        shot *= POWER_INFO[effect.effect].effect[effect.level - 1];
      }
    }
    damage += Math.floor(shot);
  }
  return damage;
}

// A scout cannot predict which southern entrance the group will use.
const southernVolley = createTickCache((colony: Colony) =>
  Math.min(...colony.room.find(FIND_EXIT_BOTTOM).map((pos) => volleyAt(colony, pos))),
);

function damageAfterArmor(target: Creep, volley: number): number {
  let remaining = volley,
    absorbed = 0;
  for (const part of target.body) {
    if (remaining <= 0) break;
    const ratio =
      part.type === TOUGH && part.boost ? BOOSTS[TOUGH as string][part.boost].damage : 1;
    const spent = Math.min(remaining, part.hits / ratio);
    absorbed += spent * (1 - ratio);
    remaining -= spent;
  }
  return volley - Math.round(absorbed);
}

function healingAt(enemy: Creep, enemies: Creep[]): number {
  let healing = 0;
  for (const ally of enemies) {
    if (ally.owner.username !== enemy.owner.username) continue;
    const range = enemy.pos.getRangeTo(ally);
    if (range <= 3)
      healing += CombatIntel.getHealPotential(ally) * (range <= 1 ? HEAL_POWER : RANGED_HEAL_POWER);
  }
  return healing;
}

// Contact history is for scouting. All combat actions use this tick's visible threats.
export const mobilized = createTickCache((colony: Colony): boolean => {
  if (!protectsSouthGate(colony) || colony.controller.safeMode) return false;
  for (const name of [warningRoom, "E58S43", colony.name]) {
    const room = Game.rooms[name];
    if (!room) continue;
    const enemies = getRoomPlayerHostiles(room);
    for (const enemy of enemies) {
      if (
        !enemy.body.some(
          (p) => p.hits > 0 && typeof p.boost === "string" && tierThreeBoosts.has(p.boost),
        ) ||
        !isSiegeUnit(enemy)
      )
        continue;
      const volley = name === colony.name ? volleyAt(colony, enemy.pos) : southernVolley(colony);
      if (damageAfterArmor(enemy, volley) <= healingAt(enemy, enemies)) return true;
    }
  }
  return false;
});

// The two southern exits meet this line. Target existing friendly fortifications only.
export const southRamparts = createTickCache((room: Room) =>
  getRoomRamparts(room).filter(
    (r) =>
      r.my &&
      ((r.pos.y === 47 && r.pos.x >= 17 && r.pos.x <= 34) || (r.pos.y === 46 && r.pos.x === 17)),
  ),
);

const gateEnemies = createTickCache((room: Room) => {
  const walls = southRamparts(room);
  const candidates = getRoomPlayerHostiles(room).filter(isSiegeUnit);
  function rank(c: Creep): number {
    const touching = walls.some((w) => w.pos.isNearTo(c));
    if (touching && c.getActiveBodyparts(WORK)) return 0;
    if (touching && c.getActiveBodyparts(ATTACK)) return 1;
    return 2;
  }
  return candidates.sort(
    (a, b) => rank(a) - rank(b) || a.hits - b.hits || a.id.localeCompare(b.id),
  );
});

export const gateEnemy = (room: Room): Creep | undefined => gateEnemies(room)[0];

// One standard UH2O guard has twenty ATTACK parts. A second melee creep still cannot
// reach a drainer when only one shield adjoins its tile; add ranged cover in that case.
export function needsGateRanger(colony: Colony): boolean {
  const enemies = getRoomPlayerHostiles(Game.rooms[colony.name]);
  const melee = 20 * ATTACK_POWER * BOOSTS.attack[guardBoost].attack;
  return enemies.some(
    (enemy) =>
      enemy.getActiveBodyparts(RANGED_ATTACK) > 0 &&
      southRamparts(colony.room).some((w) => w.pos.inRangeTo(enemy, 3)) &&
      damageAfterArmor(enemy, volleyAt(colony, enemy.pos) + melee) <= healingAt(enemy, enemies),
  );
}

// Commit a second melee attacker only to a persistent wall fight where it can beat the escort's healing.
export const needsGateBreaker = createTickCache((colony: Colony): boolean => {
  const room = colony.room,
    target = gateEnemy(room);
  if (
    !target ||
    !target.getActiveBodyparts(WORK) ||
    !southRamparts(room).some((w) => w.pos.isNearTo(target))
  )
    return false;
  const enemies = getRoomPlayerHostiles(room);
  if (!enemies.some((e) => e !== target && e.pos.isNearTo(target) && e.getActiveBodyparts(HEAL)))
    return false;
  const heals = healingAt(target, enemies);
  const normal = 20 * ATTACK_POWER * BOOSTS.attack[guardBoost].attack;
  const burst = 24 * ATTACK_POWER * BOOSTS.attack[RESOURCE_CATALYZED_UTRIUM_ACID].attack;
  const volley = volleyAt(colony, target.pos) + normal;
  return (
    damageAfterArmor(target, volley + 200) <= heals &&
    damageAfterArmor(target, volley + burst) > heals
  );
});

function supportingMeleePost(
  unit: Zerg,
  colony: Colony,
  target: Creep,
  walls: StructureRampart[],
): RoomPosition | undefined {
  const open = walls.find(
    (w) => w.pos.isNearTo(target) && (unit.pos.isEqualTo(w) || !w.pos.lookFor(LOOK_CREEPS).length),
  );
  if (open) return open.pos;
  // Only the two gaps in our own shield line; never step towards the exit. Reserve enough HP
  // to finish the focus and retreat even if the whole visible escort turns on this guard.
  for (const x of [23, 22]) {
    const p = colony.room.getPositionAt(x, 47);
    if (
      !p ||
      !p.isNearTo(target) ||
      Game.map.getRoomTerrain(colony.name).get(x, 47) === TERRAIN_MASK_WALL ||
      p
        .lookFor(LOOK_STRUCTURES)
        .some(
          (s) =>
            s.structureType !== STRUCTURE_ROAD &&
            s.structureType !== STRUCTURE_CONTAINER &&
            !(s.structureType === STRUCTURE_RAMPART && s.my),
        ) ||
      (!unit.pos.isEqualTo(p) && p.lookFor(LOOK_CREEPS).length)
    )
      continue;
    const incoming = getRoomPlayerHostiles(colony.room).reduce((n, e) => {
      const range = p.getRangeTo(e);
      return (
        n +
        (range <= 2 ? ATTACK_POWER * CombatIntel.getAttackPotential(e) : 0) +
        (range <= 4 ? RANGED_ATTACK_POWER * CombatIntel.getRangedAttackPotential(e) : 0)
      );
    }, 0);
    if (unit.creep.hits > Math.max(unit.creep.hitsMax / 2, incoming * 12)) return p;
  }
}

export function gateTowerTarget(colony: Colony): Creep | undefined {
  const room = colony.room;
  const enemies = getRoomPlayerHostiles(room);
  for (const target of gateEnemies(room)) {
    let volley = volleyAt(colony, target.pos);
    if (!volley) continue;
    for (const defender of getRoomCreeps(room)) {
      if (defender.spawning) continue;
      const range = defender.pos.getRangeTo(target);
      if (range <= 1) volley += ATTACK_POWER * CombatIntel.getAttackPotential(defender);
      if (range <= 3)
        volley += RANGED_ATTACK_POWER * CombatIntel.getRangedAttackPotential(defender);
    }
    const damage = damageAfterArmor(target, volley);
    // A drainer on the exit can leave immediately and heal before the next volley.
    if (target.pos.y === 49 && damage < target.hits) continue;
    if (damage > healingAt(target, enemies) || damage >= target.hits) return target;
  }
}

export const attackedWall = createTickCache((room: Room) => {
  const walls = southRamparts(room);
  // Events report the last tick's damage even if the attacker has already crossed the exit.
  const events = room.getEventLog().filter((e) => e.event === EVENT_ATTACK);
  const hit = walls
    .filter((w) => events.some((e) => e.data.targetId === w.id))
    .sort((a, b) => a.hits - b.hits)[0];
  if (hit) return hit;
  const enemy = gateEnemy(room);
  if (enemy && (enemy.getActiveBodyparts(WORK) || enemy.getActiveBodyparts(ATTACK))) {
    return walls.filter((w) => w.pos.isNearTo(enemy)).sort((a, b) => a.hits - b.hits)[0];
  }
});

// Keep the last contested wall through brief gaps in vision. This only assigns existing units;
// it does not prolong recruitment, lab orders or tower fire.
export const southFront = createTickCache((colony: Colony): StructureRampart | undefined => {
  const hit = attackedWall(colony.room);
  if (hit && !colony.controller.safeMode) {
    const watch = (colony.memory.southWatch ??= { tick: Game.time });
    watch.front = { wall: hit.id, seen: Game.time };
    return hit;
  }
  return recentSouthFront(colony);
});

function recentSouthFront(colony: Colony): StructureRampart | undefined {
  const watch = colony.memory.southWatch;
  if (!watch?.front) return;
  const front = watch.front;
  if (!colony.controller.safeMode && Game.time - front.seen <= holdFrontTicks) {
    const held = southRamparts(colony.room).find((w) => w.id === front.wall);
    if (held) return held;
  }
  delete watch.front;
}

export function defendSouthGate(
  unit: Zerg,
  colony: Colony,
  front?: StructureRampart,
  range = 1,
  supportMelee = false,
): void {
  const room = colony.room,
    walls = southRamparts(room);
  const target = gateEnemy(room);
  const enemies = gateEnemies(room);
  const inReach = enemies.find((e) => unit.pos.inRangeTo(e, range));
  if (inReach) {
    if (range === 1) unit.creep.attack(inReach);
    else unit.creep.rangedAttack(inReach);
  }
  const current = walls.find((w) => unit.pos.isEqualTo(w));
  // Stay on a rampart that already covers the attacker. Don't follow its escort off the front.
  let post = front;
  if (target && current?.pos.inRangeTo(target, range)) post = current;
  else if (target && (range > 1 || !front || !front.pos.isNearTo(target))) {
    post =
      walls
        .filter((w) => w.pos.inRangeTo(target, range) && !w.pos.lookFor(LOOK_CREEPS).length)
        .sort(
          (a, b) =>
            (range > 1 ? +a.pos.isNearTo(target) - +b.pos.isNearTo(target) : 0) ||
            unit.pos.getRangeTo(a) - unit.pos.getRangeTo(b) ||
            b.hits - a.hits,
        )[0] || front;
  }
  if (range > 1) {
    const saved = walls.find(
      (w) =>
        w.id === unit.memory.southRangerPost &&
        (w === current || !w.pos.lookFor(LOOK_CREEPS).length),
    );
    if (
      saved &&
      (!target || (!current?.pos.inRangeTo(target, range) && saved.pos.inRangeTo(target, range)))
    )
      post = saved;
    else if (!target && current) post = current;
    if (post && post !== current && post.pos.lookFor(LOOK_CREEPS).length) {
      post = walls
        .filter((w) => w === current || !w.pos.lookFor(LOOK_CREEPS).length)
        .sort(
          (a, b) =>
            a.pos.getRangeTo(post!) - b.pos.getRangeTo(post!) ||
            unit.pos.getRangeTo(a) - unit.pos.getRangeTo(b),
        )[0];
    }
    if (post) unit.memory.southRangerPost = post.id;
  }
  post ??= current || walls.find((w) => w.pos.x === 24 && w.pos.y === 47) || walls[0];
  if (!target && post && post !== current && post.pos.lookFor(LOOK_CREEPS).length) {
    post =
      current ||
      walls
        .filter((w) => !w.pos.lookFor(LOOK_CREEPS).length)
        .sort(
          (a, b) =>
            a.pos.getRangeTo(post!) - b.pos.getRangeTo(post!) ||
            unit.pos.getRangeTo(a) - unit.pos.getRangeTo(b),
        )[0];
  }
  let destination = post?.pos;
  if (
    supportMelee &&
    target &&
    (needsGateBreaker(colony) ||
      (target.pos.y === 48 &&
        target.getActiveBodyparts(HEAL) &&
        walls.some((w) => w.pos.isNearTo(target))))
  ) {
    destination =
      supportingMeleePost(unit, colony, target, walls) ||
      (
        current ||
        walls
          .filter((w) => !w.pos.lookFor(LOOK_CREEPS).length)
          .sort((a, b) => unit.pos.getRangeTo(a) - unit.pos.getRangeTo(b))[0]
      )?.pos;
  }
  if (!destination) return;
  if (!unit.pos.isEqualTo(destination)) {
    unit.creep.moveTo(destination, {
      range: 0,
      maxRooms: 1,
      reusePath: 0,
      costCallback: (_name, matrix) => {
        for (let x = 0; x < 50; x++) {
          matrix.set(x, 48, 255);
          matrix.set(x, 49, 255);
        }
        for (const wall of walls) {
          if (matrix.get(wall.pos.x, wall.pos.y) < 255) matrix.set(wall.pos.x, wall.pos.y, 1);
        }
        return matrix;
      },
      plainCost: 4,
    });
  }
  unit.blockMovement = true;
}
export function prepWall(colony: Colony): StructureRampart | undefined {
  if (!protectsSouthGate(colony)) return;
  const order = colony.memory.southWatch?.restore;
  if (order && !order.finished) {
    const walls = southRamparts(colony.room);
    // Leave a small decay allowance so the first segment stays above 2M until the last is done.
    const weak = walls.filter((w) => w.hits < southWallHits);
    const previous = walls.find((w) => w.id === order.target && w.hits < southWallHits + 15000);
    if (weak.length && previous) return previous;
    const target = weak.sort(
      (a, b) =>
        +(Math.max(Math.abs(a.pos.x - order.x), Math.abs(a.pos.y - order.y)) > 1) -
          +(Math.max(Math.abs(b.pos.x - order.x), Math.abs(b.pos.y - order.y)) > 1) ||
        a.hits - b.hits,
    )[0];
    if (target) {
      order.target = target.id;
      return target;
    }
    delete order.target;
    if (walls.length) order.finished = Game.time;
  }
  return plannedRepair(colony.room);
}

const plannedRepair = createTickCache(
  (room: Room) =>
    southRamparts(room)
      .filter((r) => r.hits < southWallHits)
      .sort(
        (a, b) =>
          Math.floor(a.hits / 250000) - Math.floor(b.hits / 250000) ||
          Math.abs(a.pos.x - 24) - Math.abs(b.pos.x - 24) ||
          a.id.localeCompare(b.id),
      )[0],
);

// Keep the supply route on the protected side, even when the shorter road goes out of the gate.
function blockOutside(matrix: CostMatrix): CostMatrix {
  for (let x = 0; x < 50; x++) {
    for (let y = 47; y < 50; y++) matrix.set(x, y, 255);
  }
  return matrix;
}

function insideMove(unit: Zerg, target: RoomPosition, range: number): void {
  const creep = unit.creep;
  // A hauler caught outside when the alarm starts must still be able to cross the gate inward.
  const retreat = creep.pos.y > 47 && creep.room.storage;
  if (retreat) {
    creep.moveTo(retreat, { range: 1, maxRooms: 1, reusePath: 0 });
    return;
  }
  if (creep.pos.inRangeTo(target, range) || creep.fatigue) return;
  // Use the colony traffic manager: the only corridor to the east end of the cut is one
  // tile wide. Two native moveTo calls in opposite directions take incomplete detours.
  unit.goTo(target, {
    range,
    pathOpts: {
      maxRooms: 1,
      blockExits: true,
      modifyRoomCallback: (_room, matrix) => blockOutside(matrix),
    },
  });
}

export function supplyWallWorker(colony: Colony, unit: Zerg, wall: StructureRampart): void {
  const c = unit.creep;
  if (unit.task) unit.task = null;
  const source = colony.storage?.store.energy ? colony.storage : colony.terminal;
  if (c.store.energy === 0 && source?.store.energy) {
    if (
      c.pos.y < 47 &&
      c.pos.inRangeTo(wall, 3) &&
      (mobilized(colony) ||
        recentSouthFront(colony) ||
        (colony.memory.southWatch?.restore && !colony.memory.southWatch.restore.finished))
    ) {
      c.memory.southSupplySince ??= Game.time;
      if (
        Game.time - c.memory.southSupplySince < 20 &&
        colony.overlords.logistics.transporters.some(
          (t) =>
            !t.spawning &&
            t.room.name === colony.name &&
            !t.memory.southGateDelivery &&
            !t.hasMineralsInCarry &&
            t.store.energy > 0 &&
            t.pos.inRangeTo(c, 10),
        )
      )
        return;
    }
    if (c.withdraw(source, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) insideMove(unit, source.pos, 1);
  } else {
    delete c.memory.southSupplySince;
    if (c.repair(wall) === ERR_NOT_IN_RANGE || c.pos.y >= 47) insideMove(unit, wall.pos, 3);
  }
}

const salvagePiles = createTickCache((room: Room) =>
  getRoomDroppedEnergy(room).filter(
    (d) => d.pos.y <= 47 || (d.pos.y === 48 && southRamparts(room).some((w) => w.pos.isNearTo(d))),
  ),
);

// Include energy returned by spawn recycling before the tombstones expire.
function homeTombs(colony: Colony) {
  return colony.tombstones.filter(
    (t) => t.pos.roomName === colony.name && t.pos.y < 47 && t.store.energy > 0,
  );
}

export function needsRecoveryTruck(colony: Colony): boolean {
  return (
    salvagePiles(colony.room).reduce((n, d) => n + d.amount, 0) +
      homeTombs(colony).reduce((n, t) => n + t.store.energy, 0) >=
      800 &&
    !colony.overlords.logistics.transporters.some((t) => !t.spawning && t.room.name === colony.name)
  );
}

const recoveringCarrier = createTickCache((colony: Colony) => {
  const drops = salvagePiles(colony.room);
  if (!drops.length) return undefined;
  return colony.overlords.logistics.transporters
    .filter(
      (t) =>
        !t.spawning &&
        t.room.name === colony.name &&
        t.pos.y < 47 &&
        !t.memory.southGateDelivery &&
        !t.hasMineralsInCarry &&
        t.store.getFreeCapacity() > 0,
    )
    .map((t) => ({
      name: t.name,
      score: drops.reduce(
        (best, d) =>
          Math.max(
            best,
            Math.min(d.amount, t.store.getFreeCapacity()) / Math.max(1, t.pos.getRangeTo(d)),
          ),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))[0]?.name;
});

// Reuse the same danger mask for every carrier this tick. Stops and routes both use this mask;
// an inside drop can be collected from an adjacent safe square even if the pile itself is exposed.
const recoveryCosts = createTickCache((colony: Colony) => {
  const room = colony.room;
  const costs = MatrixLib.getMatrix(room.name, { blockExits: true }, { blockCreeps: true }).clone();
  const covered = southRamparts(room).map((w) => ({ wall: w, cost: costs.get(w.pos.x, w.pos.y) }));
  const gaps = [22, 23].map((x) => ({ x, cost: costs.get(x, 47) }));
  blockOutside(costs);
  // These two gaps also reach the spill at (23,48). Never cross the line, and do not use
  // an exposed gap near an enemy on either side of the exit.
  const approach = Game.rooms.E58S43;
  if (approach) {
    for (const { x, cost } of gaps) {
      if (!getRoomPlayerHostiles(approach).some((e) => e.pos.y <= 3 && Math.abs(e.pos.x - x) <= 5))
        costs.set(x, 47, cost);
    }
  }
  for (const hostile of getRoomPlayerHostiles(room)) {
    const range = hostile.getActiveBodyparts(RANGED_ATTACK)
      ? 4
      : hostile.getActiveBodyparts(ATTACK)
        ? 2
        : 0;
    if (!range) continue;
    for (
      let x = Math.max(0, hostile.pos.x - range);
      x <= Math.min(49, hostile.pos.x + range);
      x++
    ) {
      for (
        let y = Math.max(0, hostile.pos.y - range);
        y <= Math.min(49, hostile.pos.y + range);
        y++
      )
        costs.set(x, y, 255);
    }
  }
  // Allow the pickup from atop a strong friendly rampart, never from the exposed row
  // beyond it. Keep the contested post and occupied ramparts free for their defenders.
  const held = recentSouthFront(colony);
  for (const { wall, cost } of covered) {
    if (wall !== held && wall.hits >= 100000 && !wall.pos.lookFor(LOOK_CREEPS).length) {
      costs.set(wall.pos.x, wall.pos.y, cost);
    }
  }
  return costs;
});

const claimedDrops = createTickCache((_room: Room) => new Map<Id<Resource>, number>());

function collectGateEnergy(colony: Colony, creep: Creep): boolean {
  const space = creep.store.getFreeCapacity();
  if (!space || creep.pos.y > 47) return false;
  const claims = claimedDrops(colony.room);
  const drops = salvagePiles(colony.room).filter(
    (drop) =>
      drop.amount > (claims.get(drop.id) || 0) &&
      drop.amount > Math.max(0, creep.pos.getRangeTo(drop) - 1),
  );
  if (!drops.length) {
    delete creep.memory.southPickup;
    return false;
  }
  const score = (d: Resource) => Math.min(space, d.amount) / Math.max(1, creep.pos.getRangeTo(d));
  const assigned = creep.memory.southPickup;
  drops.sort((a, b) => +(b.id === assigned) - +(a.id === assigned) || score(b) - score(a));
  for (const drop of drops) {
    if (creep.pos.isNearTo(drop)) {
      if (creep.pickup(drop) !== OK) continue;
      delete creep.memory.southPickup;
      creep.memory.southGateDelivery = true;
    } else {
      const costs = recoveryCosts(colony);
      const search = PathFinder.search(
        creep.pos,
        { pos: drop.pos, range: 1 },
        {
          roomCallback: () => costs,
          plainCost: 2,
          swampCost: 10,
          maxRooms: 1,
        },
      );
      if (search.incomplete || !search.path.length) continue;
      creep.memory.southPickup = drop.id;
      creep.move(creep.pos.getDirectionTo(search.path[0]));
    }
    claims.set(drop.id, (claims.get(drop.id) || 0) + space);
    return true;
  }
  return false;
}

// A dedicated recovery truck may deliver its cargo straight into a pending siege spawn.
export function supplyGateSpawn(colony: Colony, unit: Zerg): boolean {
  if (!unit.store.energy) {
    const bank = colony.storage?.store.energy ? colony.storage : colony.terminal;
    if (!bank?.store.energy) return false;
    if (unit.creep.withdraw(bank, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE)
      insideMove(unit, bank.pos, 1);
    return true;
  }
  const sinks = [...colony.spawns, ...colony.extensions].filter(
    (s) => s.isActive() && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  );
  const target = unit.pos.findClosestByPath(sinks, { maxRooms: 1 });
  if (!target) return false;
  if (unit.creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE)
    insideMove(unit, target.pos, 1);
  return true;
}

export function recoverGateCargo(colony: Colony, unit: Zerg): boolean {
  const c = unit.creep;
  const repair = colony.memory.southWatch?.restore;
  const wallPile = salvagePiles(colony.room).some((p) => p.pos.y >= 47 && p.amount >= 50);
  if (
    repair &&
    !repair.finished &&
    !wallPile &&
    !c.memory.southGateDelivery &&
    !mobilized(colony) &&
    !recentSouthFront(colony)
  ) {
    // Both towers stop repairing at the same reserve. A tie halfway around the
    // bunker must not send a loaded truck all the way back to its previous tower.
    const towers = colony.towers.filter((t) => t.store.energy < 850);
    const tower =
      towers.find((t) => t.id === c.memory.southSupplyTower) ||
      towers.sort(
        (a, b) => a.store.energy - b.store.energy || c.pos.getRangeTo(a) - c.pos.getRangeTo(b),
      )[0];
    const source = colony.storage?.store.energy ? colony.storage : colony.terminal;
    if (tower && source && (c.store.energy || source.store.energy)) {
      c.memory.southSupplyTower = tower.id;
      const target = c.store.energy ? tower : source;
      const result = c.store.energy
        ? c.transfer(tower, RESOURCE_ENERGY)
        : c.withdraw(source, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) insideMove(unit, target.pos, 1);
      else if (target === tower && result === OK) delete c.memory.southSupplyTower;
      unit.blockMovement = true;
      return true;
    }
  }
  delete c.memory.southSupplyTower;
  if (c.store.energy > 0) {
    const evacuation = colony.memory.terminalEvacuation;
    const destinations =
      evacuation && (!evacuation.returnEnergy || evacuation.breachedAt !== undefined)
        ? [colony.terminal, colony.storage]
        : [colony.storage, colony.terminal];
    const bank = destinations.find((s) => s && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
    if (!bank) return true;
    if (c.transfer(bank, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) insideMove(unit, bank.pos, 1);
    unit.blockMovement = true;
    return true;
  }
  delete c.memory.southGateDelivery;
  if (collectGateEnergy(colony, c)) {
    unit.blockMovement = true;
    return true;
  }
  for (const t of homeTombs(colony).sort(
    (a, b) => a.ticksToDecay - b.ticksToDecay || c.pos.getRangeTo(a) - c.pos.getRangeTo(b),
  )) {
    if (c.pos.isNearTo(t)) {
      if (c.withdraw(t, RESOURCE_ENERGY) === OK) return true;
    } else {
      const path = PathFinder.search(
        c.pos,
        { pos: t.pos, range: 1 },
        { maxRooms: 1, roomCallback: () => recoveryCosts(colony), plainCost: 2, swampCost: 10 },
      );
      if (!path.incomplete && path.path.length) {
        c.move(c.pos.getDirectionTo(path.path[0]));
        return true;
      }
    }
  }
  return false;
}

// Leave one repairer on duty. Other menders can reach a spill before a replacement truck is born.
export function recoverWithMenders(colony: Colony, units: Zerg[]): Set<Zerg> {
  const busy = new Set<Zerg>();
  const active = units.filter((u) => !u.spawning && u.room.name === colony.name);
  if (!active.length) return busy;
  const bank = [colony.storage, colony.terminal].find(
    (s) => s && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  );
  if (!bank) return busy;
  const repairer = active.find((u) => !u.memory.southGateDelivery);
  const drops = salvagePiles(colony.room);
  const candidates = active
    .filter(
      (u) => u.memory.southGateDelivery || (u !== repairer && drops.length && !u.store.energy),
    )
    .sort(
      (a, b) =>
        Math.min(...drops.map((d) => a.pos.getRangeTo(d))) -
        Math.min(...drops.map((d) => b.pos.getRangeTo(d))),
    );
  for (const u of candidates) {
    if (u.memory.southGateDelivery && u.store.energy > 0) {
      if (u.creep.transfer(bank, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) insideMove(u, bank.pos, 1);
    } else {
      delete u.memory.southGateDelivery;
      if (!collectGateEnergy(colony, u.creep)) continue;
    }
    u.blockMovement = true;
    busy.add(u);
  }
  return busy;
}

export function supplySouthGate(colony: Colony, hauler: Zerg): boolean {
  if (!protectsSouthGate(colony) || hauler.room.name !== colony.name || hauler.spawning)
    return false;
  const c = hauler.creep;
  const storage = colony.storage || colony.terminal;
  if (!storage) return false;
  if (c.memory?.southGateDelivery) {
    if (c.store.energy) {
      const bank = [colony.storage, colony.terminal].find(
        (s) => s && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      );
      if (bank) {
        if (hauler.task) hauler.task = null;
        if (c.transfer(bank, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) insideMove(hauler, bank.pos, 1);
        return true;
      }
    }
    delete c.memory.southGateDelivery;
  }
  const restore = colony.memory.southWatch?.restore;
  if (
    restore &&
    !restore.finished &&
    !mobilized(colony) &&
    !recentSouthFront(colony) &&
    (colony.overlords.logistics.transporters[0]?.name !== hauler.name ||
      ((colony.memory.restartMiningUntil ?? 0) > Game.time &&
        colony.overlords.logistics.transporters.length < 2))
  )
    return false;
  if (
    !mobilized(colony) &&
    !recentSouthFront(colony) &&
    !(restore && !restore.finished && prepWall(colony))
  )
    return false;
  if (hauler.task) hauler.task = null;
  if (c.pos.y >= 47) {
    if (
      c.pos.y === 47 &&
      southRamparts(colony.room).some((w) => w.pos.isEqualTo(c)) &&
      collectGateEnergy(colony, c)
    )
      return true;
    insideMove(hauler, storage.pos, 1);
    return true;
  }
  const mineral = (Object.keys(c.store) as ResourceConstant[]).find(
    (r) => r !== RESOURCE_ENERGY && c.store[r] > 0,
  );
  if (mineral) {
    if (c.transfer(storage, mineral) === ERR_NOT_IN_RANGE) insideMove(hauler, storage.pos, 1);
    return true;
  }
  const workers = colony.room
    .find(FIND_MY_CREEPS)
    .filter(
      (w) =>
        !w.spawning &&
        (w.memory.role === "worker" || w.memory.role === menderRole) &&
        w.pos.y >= 40 &&
        w.pos.y <= 46 &&
        w.store.getFreeCapacity(RESOURCE_ENERGY) >= 32,
    );
  const target =
    colony.towers.find((t) => t.store.energy < (restore && !restore.finished ? 800 : 500)) ||
    workers.sort(
      (a, b) => a.store.energy - b.store.energy || c.pos.getRangeTo(a) - c.pos.getRangeTo(b),
    )[0];
  // With several trucks, leave at least one on tower/worker supply while one salvages.
  const otherSupplier = colony.overlords.logistics.transporters.some(
    (t) =>
      t.name !== hauler.name &&
      !t.spawning &&
      t.room.name === colony.name &&
      !t.memory.southGateDelivery &&
      !t.hasMineralsInCarry &&
      t.store.energy > 0,
  );
  if (
    (!target || otherSupplier) &&
    recoveringCarrier(colony) === hauler.name &&
    collectGateEnergy(colony, c)
  ) {
    hauler.blockMovement = true;
  } else if (target && c.store.energy) {
    if (c.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) insideMove(hauler, target.pos, 1);
  } else if (target) {
    const source = storage.store.energy ? storage : colony.terminal;
    if (source && c.withdraw(source, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE)
      insideMove(hauler, source.pos, 1);
  } else if (c.store.energy && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    if (c.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE)
      insideMove(hauler, storage.pos, 1);
  } else if (c.pos.y >= 46) insideMove(hauler, storage.pos, 2);
  return true;
}
