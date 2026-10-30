// Reference behavior from the source before the hot-path pass, using Screeps' Lodash 3.
const _ = require('../helpers/screeps-lodash.cjs');
const constants = require('@screeps/common/lib/constants');

function createBaseline(overrides = {}) {
  const BOOST_PARTS = Object.fromEntries(Object.entries(constants.BOOSTS).flatMap(([part, boosts]) =>
    Object.keys(boosts).map(boost => [boost, part])));
  const {BODYPART_COST, BOOSTS, MOVE, CARRY, LAB_BOOST_MINERAL} = {...constants, ...overrides};
  function speedGetter() {
    if (this._moveSpeed == undefined) {
      const movePower = _.sum(this.body,
        part => part.type == MOVE && part.boost ? BOOSTS.move[part.boost].fatigue : 0);
      const nonMoveParts = _.sum(this.body, part => part.type != MOVE ? 1 : 0);
      this._moveSpeed = Math.max(movePower / nonMoveParts, 1);
    }
    return this._moveSpeed;
  }
  return {
    bodyCost: body => _.sum(body, part => BODYPART_COST[part]),
    nameLookup: units => _.zipObject((units || []).map(unit => [unit.name, true])),
    uniqueBoosts: body => _.compact(_.unique(body.map(part => part.boost))),
    speed: body => speedGetter.call({body}),
    requiredBoostAmount(body, boostType) {
      const existingBoostCounts = _.countBy(body, part => part.boost);
      const numPartsToBeBoosted = body.filter(part => part.type == BOOST_PARTS[boostType]).length;
      return LAB_BOOST_MINERAL * (numPartsToBeBoosted - (existingBoostCounts[boostType] || 0));
    },
    weight(creep, analyzeCarry = true) {
      const unweightedParts = analyzeCarry ? [MOVE, CARRY] : [MOVE];
      const bodyParts = _.countBy(creep.body, part => unweightedParts.includes(part.type) ? part.type : 'weighted');
      bodyParts.move = bodyParts.move || 0;
      bodyParts.weighted = bodyParts.weighted || 0;
      if (analyzeCarry && bodyParts[CARRY]) {
        bodyParts.weighted += Math.ceil(bodyParts[CARRY] * creep.store.getUsedCapacity() / creep.store.getCapacity());
      }
      for (const part of creep.body) {
        if (part.type == MOVE && part.boost) bodyParts.move += BOOSTS.move[part.boost].fatigue - 1;
      }
      return bodyParts;
    },
    rangeToEdge: pos => _.min([pos.x, 49 - pos.x, pos.y, 49 - pos.y]),
    multiRoomRange(from, to) {
      if (from.roomName == to.roomName) return from.getRangeTo(to);
      const fromCoords = from.roomCoords, toCoords = to.roomCoords;
      const dx = Math.abs(50 * (toCoords.x - fromCoords.x) + to.x - from.x);
      const dy = Math.abs(50 * (toCoords.y - fromCoords.y) + to.y - from.y);
      return _.max([dx, dy]);
    },
  };
}

module.exports = {createBaseline};
