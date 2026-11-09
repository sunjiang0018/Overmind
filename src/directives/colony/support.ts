import { ColonySupportOverlord } from "../../overlords/colonization/support";
import { profile } from "../../profiler/decorator";
import { Directive } from "../Directive";

export interface ColonySupportMemory extends FlagMemory {
  reserve?: number;
  targetRCL?: number;
  maxBuilders?: number;
  maxHaulers?: number;
  maxGuards?: number;
  minGuards?: number;
  warningRoom?: string;
  warningPos?: Coord;
  defenseAnchors?: Coord[];
  warning?: { room: string; tick: number; visible: boolean; hostiles: string[] };
  lastWarningKey?: string;
  lastWarningTick?: number;
  status?: Record<string, number | string | boolean>;
}

/** Explicitly parent-bound aid; does not replace either colony's native spawning. */
@profile
export class DirectiveColonySupport extends Directive {
  static directiveName = "colonySupport";
  static color = COLOR_PURPLE;
  static secondaryColor = COLOR_BLUE;
  memory: ColonySupportMemory;

  constructor(flag: Flag) {
    super(
      flag,
      (colony) =>
        colony.level >= 4 &&
        colony.spawns.length > 0 &&
        colony.name != Directive.getPos(flag).roomName,
    );
  }

  spawnMoarOverlords() {
    this.overlords.support = new ColonySupportOverlord(this);
  }

  init() {
    this.alert("Colony defense and development support");
  }

  run() {}
}
