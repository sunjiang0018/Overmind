// Application-owned state still attached by combat, intel and movement systems.
// Derived game data and helpers live in src/game and do not augment engine prototypes.
interface Creep {
	hitsPredicted?: number;
	intel?: { [property: string]: number };
	memory: CreepMemory;
}

interface PowerCreep {
	hitsPredicted?: number;
	intel?: { [property: string]: number };
	memory: CreepMemory;
	withdraw(target: Structure | Tombstone | Ruin, resourceType: ResourceConstant, amount?: number): ScreepsReturnCode;
}

interface CostMatrix {
	_bits: Uint8Array;
}

interface Room {
	// Populated and tracked by RoomIntel.
	isSafe: boolean;
	threatLevel: number;
	instantaneousThreatLevel: 0 | 0.5 | 1;
	// Used by movement.
	_kitingMatrix: CostMatrix;
}

type Sink = StructureSpawn | StructureExtension | StructureLab | StructurePowerSpawn | StructureNuker | StructureTower;
type StorageUnit = StructureContainer | StructureTerminal | StructureStorage;
type rechargeObjectType = StorageUnit | StructureLink | Tombstone | Ruin | Resource;

/** Resource quantities without engine Store methods; also accepts real Store instances. */
type ResourceAmounts = Partial<Record<ResourceConstant, number>>;
