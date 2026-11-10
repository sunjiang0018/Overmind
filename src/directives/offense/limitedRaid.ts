import { LimitedRaidOverlord } from "../../overlords/offense/limitedRaid";
import type { LimitedRaidMemory } from "../../strategy/limitedRaid";
import { Directive } from "../Directive";

export interface DirectiveLimitedRaidMemory extends FlagMemory {
  raid?: LimitedRaidMemory;
}

/** An explicitly ordered, single-wave raid. Keep the flag as the durable cost/retreat record. */
export class DirectiveLimitedRaid extends Directive {
  static directiveName = "limitedRaid";
  static color = COLOR_RED;
  static secondaryColor = COLOR_YELLOW;
  declare memory: DirectiveLimitedRaidMemory;

  spawnMoarOverlords(): void {
    if (this.memory.raid) this.overlords.raid = new LimitedRaidOverlord(this);
  }

  init(): void {
    this.alert(
      this.memory.raid
        ? `Limited raid: ${this.memory.raid.phase}`
        : "Limited raid requires an explicit order",
    );
  }

  run(): void {}
}
