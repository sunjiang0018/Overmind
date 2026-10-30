// Creep utilities that don't belong anywhere else

/** Lists boosts in first-occurrence order without allocating a mapped body array. */
export function getBodyBoosts(body: BodyPartDefinition[]): ResourceConstant[] {
	const boosts: ResourceConstant[] = [];
	body.forEach(part => {
		const boost = part.boost as ResourceConstant | undefined;
		if (boost && !boosts.includes(boost)) {
			boosts.push(boost);
		}
	});
	return boosts;
}

/** Builds the ordinary-object name lookup used during creep synchronization. */
export function getNameLookup(units: { name: string }[] | null | undefined): { [name: string]: boolean } {
	const names: { [name: string]: boolean } = {};
	for (const unit of units || []) {
		names[unit.name] = true;
	}
	return names;
}

// TODO should probably live in combat intell or something similar
// Does not account for range, just total of body parts
export function calculateFormationStrength(creeps: Creep[]): Record<BodyPartConstant, number> {
	const tally: Record<BodyPartConstant, number> = {
		move         : 0,
		work         : 0,
		carry        : 0,
		attack       : 0,
		ranged_attack: 0,
		tough        : 0,
		heal         : 0,
		claim        : 0,
	};

	creeps.forEach(function(unit) {
		const individualTally = calculateBodyPotential(unit.body);
		for (const bodyType in individualTally) {
			const type = bodyType as BodyPartConstant;
			tally[type] += individualTally[type];
		}
	});
	return tally;
}

export function calculateBodyPotential(body: BodyPartDefinition[]): Record<BodyPartConstant, number> {
	const tally: Record<BodyPartConstant, number> = {
		move         : 0,
		work         : 0,
		carry        : 0,
		attack       : 0,
		ranged_attack: 0,
		tough        : 0,
		heal         : 0,
		claim        : 0,
	};
	body.forEach(function(bodyPart) {
		// Needs boost logic
		tally[bodyPart.type] += 1;
	});
	return tally;
}
