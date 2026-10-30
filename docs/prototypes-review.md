# src/prototypes 扩展原型评审

> 评审对象：`src/prototypes/` 下 10 个文件、约 130 个原型成员（属性 / getter / 方法 / 猴子补丁）。
> 基线：`e90cab5`（`dev` 分支，含未提交的 Lodash 原生迁移），Node 24.18，`@types/screeps@3.4.0`，Screeps engine 4.3.2。
> 验证：评审时 `npx tsc --noEmit -p .` 通过、`npm run test:unit` 88/88 通过；实施后 95/95、bundle 6/6 通过。关键结论用 engine 源码与 Node 复现验证；性能数字来自本地合成微基准（见附录 A，仅作相对参考）。

---

## 0. 结论速览

| 级别 | 位置 | 问题 | 影响 |
| --- | --- | --- | --- |
| **P0** | `Room.ts:136` + `Creep.ts:80` | `playerHostiles` 使用从未定义的 `creep.isHuman`（2020 年重命名为 `isPlayer` 后漏改） | `playerHostiles` / `dangerousPlayerHostiles` 恒为空；玩家进攻不触发防御、安全模式、威胁评估 |
| **已排除** | `RoomStructures.ts:185-200` | 初版报告曾误判 `constructedWalls` 未定义；实际上 `STRUCTURE_WALL === 'constructedWall'`，`multipleList` 生成的正是 `constructedWalls`，`walls` 只是它的别名 | 无缺陷；实现阶段用测试确认并回退了错误修改 |
| **P0** | `Game.ts:3-26` | 对 `Game.market.deal` 的实例补丁只活在 global reset 那一个 tick；且解引用调用丢失 `this` | 市场成交后 `_notReady` 基本不会生效；reset tick 上成交可能直接抛错 |
| **P0** | `Miscellaneous.ts:8` | `Number#truncate` 用正则实现，负数丢失符号、科学计数法不截断 | `Stats.log` 的负值（CPU、能量差等）被写成正数 |
| **P0** | `RoomPosition.ts:155` / `:178` | `getPositionsInRange` / `getPositionsAtRange` 的 y 边界误用了 `xmin`/`xmax`（写成 `xmin <= y && y <= xmax`） | 当前 x/y 边界相同所以无症状，属于会咬人的复制粘贴错误 |
| **P1** | `RoomStructures.ts:144-168` | `walkableRamparts` 对每个 rampart 调 `pos.isWalkable(true)`（每条 rampart 取 terrain + `lookFor(LOOK_STRUCTURES)`） | 工事/寻路热路径 CPU 放大；可用一次 `structures` 扫描替代 |
| **P1** | `RoomPosition.ts:181-196` | `availableNeighbors` 先建 8 个 `RoomPosition`，再逐格 2 次 `lookFor` + 8 次取 terrain | 任务/移动热路径的分配与原生调用偏多 |
| **P1** | `Room.ts:125-161` | `dangerousHostiles` 对每个 hostile 调 3 次 `getActiveBodyparts`；`dangerousPlayerHostiles` 再扫一遍 | 可用一次 body 反向扫描 + 从 `dangerousHostiles` 派生 |
| **P1** | `RoomPosition.ts:91-101` | `roomCoords` 每次访问跑正则；`getMultiRoomRangeTo` 一次调用跑两次 | 物流/资产排序热路径；缓存后约 8.8× |
| **P1** | `RoomStructures.ts:112-140` | `repairables` 的 `singleList` 循环没有应用 `notRepairable` | invader core 被放进 `repairables`，与 `notRepairable` 语义矛盾 |
| **P1** | `Structures.ts` / `Miscellaneous.ts` / `Creep.ts` | `PERMACACHE.structureWalkability`、`Creep.isPlayer` 按 id 永久缓存 | 全局堆随对象数量单调增长；这两者实测直接计算更快 |
| **P2** | 多处 | 类型声明幻影 / 死代码 / 重复实现 / 可枚举原型污染 | 维护成本、类型失真、隐藏 bug |

**总体判断**：最近一轮 Lodash→原生迁移的质量不错（顺序、默认值、空数组、缓存语义都保留了，且有针对性测试）。剩余问题集中在两类：**跨文件契约失配**（`isHuman`/`isPlayer`、`Game` 每 tick 重建）和**热路径上重复的原生 API 调用**。

---

## 1. P0 缺陷（建议立即修复）

### P0-1 `Room.playerHostiles` 永远为空

证据链：

```ts
// src/prototypes/Room.ts:136
this._playerHostiles = this.hostiles.filter((creep: Creep) => creep.isHuman);

// src/prototypes/Creep.ts:80 —— 实际定义的是 isPlayer
Object.defineProperty(Creep.prototype, 'isPlayer', { ... });
```

- 全仓库只有 `Room.ts` 和 `tests/native-arrays.test.cjs:116` 使用 `isHuman`，没有任何地方定义它；`isPlayer` 除了定义处没有任何消费者。
- `git log -S"isHuman"` 显示上游 `da8a116`（2020-04）把 `isHuman` 整体改名为 `isPlayer`，但漏改了 `Room.ts` 和 `prototypes.d.ts`。
- 现有单测没有暴露它，因为 fixture 自己给假 creep 加了一个 `isHuman` 字段（`tests/native-arrays.test.cjs:116`），把生产契约替换掉了。

影响：`playerHostiles`、`dangerousPlayerHostiles` 恒为 `[]`。使用方包括 `invasionDefense.ts`、`RoomIntel.ts:618/651`、`Overseer.ts:270/551/562`、`AnyZerg.ts:440`、`Swarm.ts:442`、`roomPoisoner.ts:42`——玩家进攻时防御/安全模式/威胁评估会失明（`dangerousHostiles` 本身仍包含玩家，所以部分战斗逻辑不受影响，但所有 `*PlayerHostiles` 消费者都不受影响）。

建议修复（同时删除 `PERMACACHE.isPlayer`，见 P1）：

```ts
// Creep.ts
Object.defineProperty(Creep.prototype, 'isPlayer', {
	get() {
		const username = this.owner.username;
		return username != 'Invader' && username != 'Source Keeper' && username != 'Screeps';
	},
	configurable: true,
});

// Room.ts
this._playerHostiles = this.hostiles.filter((creep: Creep) => creep.isPlayer);
this._dangerousPlayerHostiles = this.dangerousHostiles.filter((creep: Creep) => creep.isPlayer);
```

`prototypes.d.ts`：删掉 `isHuman: true`，补 `isPlayer: boolean`。测试 fixture 同步改为 `isPlayer`，并增加一条“`Creep.prototype.isHuman` 不存在”的契约测试，避免以后再用幻影属性。

### P0-2（已排除的误报）`Room.walls` / `constructedWalls` 并非未定义

初版报告认为 `RoomStructures.ts:185-200` 的 `walls` getter 读取了从未定义的 `constructedWalls`。实现阶段用真实常量核对后发现这是误报：

```js
// @screeps/common/lib/constants
STRUCTURE_WALL === 'constructedWall';
```

因此 `multipleList.forEach` 为 `STRUCTURE_WALL` 生成的属性名就是 **`constructedWalls`**（`type + 's'`），而文件末尾的：

```ts
Object.defineProperty(Room.prototype, 'walls', {
	get() {
		return this.constructedWalls;
	},
	configurable: true,
});
```

只是给这个生成的 getter 起了一个短别名。`barriers` 的 `[].concat(this.ramparts, this.constructedWalls)` 也始终拿到数组，不会出现 `undefined`。初版报告把它误当成 `STRUCTURE_WALL === 'wall'` 的普通命名，是本次评审中唯一被证伪的结论；实现时已回退对应修改，并新增：

```ts
// tests/prototypes-regressions.test.cjs
assert.equal(room.walls, room.constructedWalls);
assert.deepEqual(Array.from(room.walls, s => s.id), ['wall', 'indestructible']);
```

作为防回归断言。`RoomPlanner.ts:563` 的 `room.walls.forEach(...)` 也保持原样（`walls` 与 `constructedWalls` 等价）。

### P0-3 `Game.market.deal` 补丁的生存期与 `this` 绑定

```ts
// src/prototypes/Game.ts:3-26
const _marketDeal = Game.market.deal;
Game.market.deal = function(orderId, amount, targetRoomName) {
	const response = _marketDeal(orderId, amount, targetRoomName); // ← 丢失 this
	...
};
```

两个独立问题：

1. **补丁只对一个 tick 有效。** engine 4.3.2 的 `src/game/game.js` 在每次 `init` 中执行 `globals.Game = makeGameObject(...)`（`:502`）；其中 `var game = {...}`（`:136`）和 `game.market = market.make(runtimeData, intents, register)`（`:433`）都是新建对象。玩家的模块顶层代码只在 global reset 时执行一次，所以这个实例补丁只覆盖 reset 之后的第一个 tick，之后 `Game.market` 又是原生对象。
2. **解引用调用会丢 `this`。** engine 的 `market.deal` 内部使用 `this.calcTransactionCost(...)`（`src/game/market.js:127`）。`_marketDeal(...)` 是裸函数调用，`this` 为 `undefined`（严格模式）或 global，在 reset tick 上真正成交时会抛错。

`StructureTerminal.prototype.send` 的补丁（`Structures.ts:230-241`）在原型上，跨 tick 有效，写法是对的；`Game.market` 没有暴露可补丁的原型，只能每 tick 重新应用。

建议：

```ts
// Game.ts
export function patchMarketDeal(): void {
	const market = Game.market;
	const original = market.deal;
	market.deal = function(orderId: string, amount: number, targetRoomName?: string): ScreepsReturnCode {
		const response = original.call(market, orderId, amount, targetRoomName);
		if (response == OK && targetRoomName && Game.rooms[targetRoomName]?.terminal?.my) {
			(Game.rooms[targetRoomName].terminal as any)._notReady = true;
		}
		return response;
	};
}
```

在 `main()` 每 tick 开头调用（`Game` 每 tick 都是新的，无需去重）；`d.ts` 给 `StructureTerminal` 补 `_notReady?: boolean`，去掉 `<any>`。另一种更彻底的做法是用 `Game.market.incomingTransactions`（已在 `TradeNetwork` 使用）推导 `hasReceived`，完全去掉对 `deal` 的猴子补丁；改动较大，可作为后续项。

### P0-4 `Number#truncate` 负数符号丢失

```ts
// src/prototypes/Miscellaneous.ts:8
Number.prototype.truncate = function(decimals: number): number {
	const re = new RegExp('(\\d+\\.\\d{' + decimals + '})(\\d)'),
		  m  = this.toString().match(re);
	return m ? parseFloat(m[1]) : this.valueOf();
};
```

实测：

```text
-1.2345 -> 1.23      // 符号丢了
1e-7    -> 1e-7      // 科学计数法不截断
-0.000123 -> 0
```

`Stats.log`（`src/stats/stats.ts:31`）会对负值（CPU、能量净变化等）调用它，统计会被悄悄写反。建议：

```ts
Number.prototype.truncate = function(decimals = 0): number {
	const factor = 10 ** decimals;
	return Math.trunc(this.valueOf() * factor) / factor;
};
```

并补负值、指数形式、`decimals = 0` 的测试。

### P0-5 `getPositionsInRange` 的 y 边界笔误

```ts
// src/prototypes/RoomPosition.ts:155（getPositionsAtRange 的 :178 同样）
if (xmin <= x && x <= xmax && xmin <= y && y <= xmax) {
```

y 的上下界误用了 x 的 `xmin` / `xmax`，应为 `ymin <= y && y <= ymax`。当前 `xmin === ymin`、`xmax === ymax`，所以没有可观察症状，但这是典型的复制粘贴隐患；建议同时把 `getPositionsInRange` / `getPositionsAtRange` 的公共部分抽成一个内部函数（两者只差“是否只取外环”），减少再次漂移。

---

## 2. 逐文件评审

### 2.1 `Creep.ts`

| 成员 | 结论 | 说明 / 建议 |
| --- | --- | --- |
| `boosts` | 保留 | `getBodyBoosts` 保持首次出现顺序，缓存到 `_boosts`；性能与语义都没问题。可把内部缓存字段补进 `d.ts`。 |
| `boostCounts` | 保留 | `countBy` 会把未 boost 的 `undefined` 记成字符串键 `"undefined"`，消费方都用 `|| 0`，可接受；若想更干净可只统计有 boost 的 part，但会多一次过滤，不建议。 |
| `approxMoveSpeed` | 清理或接线 | 生产代码 0 消费者（只有 d.ts 和热路径测试），属于死代码。注意注释“nonMoveParts == 0 时 Infinity -> 1”不准确：0/0 是 NaN、Infinity 仍会保留；测试已经覆盖这些边界。若确认外部/控制台不用，删除 getter 与 d.ts、测试；若保留，建议在移动估算里真正使用它。 |
| `inRampart` | 优化 | 每次访问 `pos.lookFor(LOOK_STRUCTURES)`。战斗过滤（`CombatTargeting.ts:94/129`、`CombatZerg.ts:186`）会对同一 creep 反复读。可按 tick 缓存，但要注意 `move()` 后 `pos` 可能变化；若缓存必须带位置校验，或只在战斗前计算一次。语义上任意 rampart 都算（含 public 敌方），与注释假设一致。 |
| `bodypartCounts` | 保留 | 身体构成不可变，永久缓存合理；但注意它统计**所有** part（含 `hits === 0` 的残损 part），不要把它当“有效 part 数”用（`transporter.ts:86` 的载重估计、`worker.ts:255` 的工作 part 估计在残血时会偏高）。如需有效值用引擎的 `getActiveBodyparts` 或一次 body 扫描。 |
| `isPlayer` | 保留 + 去缓存 | 目前 0 消费者（因为 P0-1），修好后建议去掉 `PERMACACHE`：3 次字符串比较实测 4.9ns，perma 查找 6.2ns，且不再随 creep 数增长。 |

### 2.2 `Game.ts`

| 成员 | 结论 | 说明 / 建议 |
| --- | --- | --- |
| `Game.market.deal` 补丁 | 修复 | 见 P0-3：每 tick 重新安装、`original.call(Game.market, ...)`、补 `_notReady` 声明。 |

### 2.3 `Miscellaneous.ts`

| 成员 | 结论 | 说明 / 建议 |
| --- | --- | --- |
| `String#padRight` / `padLeft` | 用原生替换 | 目标环境 Node 24 / ES2024 已有 `padEnd` / `padStart`；自实现还会在多字符 pad 时不截断，和原生语义不一致。调用点只有 `utilities/utils.ts:181/183` 与 `logistics/LogisticsNetwork.ts:634` 附近，建议直接换成 `padEnd` / `padStart`，然后删除这两个全局扩展；若担心外部控制台脚本依赖，可保留一个 `Object.defineProperty(..., {enumerable: false})` 的薄别名。 |
| `Number#toPercent` | 可选清理 | 生产代码目前只在注释里使用；保留成本低。若保留，建议用 `Object.defineProperty` 定义（见下）避免可枚举原型污染。 |
| `Number#truncate` | 修复 | 见 P0-4。 |
| `ConstructionSite#isWalkable` | 简化 | 只依赖 `structureType`，按 id 缓存没有收益（还多一份全局表）。直接 `return this.structureType === STRUCTURE_ROAD || ...`，并与 `Structure#isWalkable` 共享一份 `isWalkableStructureType` 判断。 |

补充：`String.prototype.xxx = function` / `Number.prototype.xxx = function` 这种赋值会让原型属性变为 **enumerable**。建议用 `Object.defineProperty(..., {enumerable: false, configurable: true})`，或直接删掉改用原生方法。

### 2.4 `PowerCreep.ts`

| 成员 | 结论 | 说明 / 建议 |
| --- | --- | --- |
| `inRampart` | 保留 / 共享 | 与 `Creep#inRampart` 完全重复（且 PowerCreep 版本目前没有消费者）。建议抽一个共享 helper，或至少复制时加注释说明同步关系。 |
| 95 行注释代码 | 删除 | 这是“把 PowerCreep 伪装成 Creep 塞进 Zerg 体系”的废弃方案，已经不在任何构建路径上；保留只会误导后续维护。 |

### 2.5 `RoomObject.ts`

| 成员 | 结论 | 说明 / 建议 |
| --- | --- | --- |
| `ref` | 保留 | `id || name || ''` 对 Creep/Structure/Resource/Flag 都成立；Flag 用 name 做 ref 时要注意 `GameCache.targets` 是普通对象，`__proto__` 之类 flag 名会造成原型链问题，建议把该字典改成 `Object.create(null)`（`caching/GameCache.ts:50`）。 |
| `targetedBy` | 保留 | `Overmind.cache.targets[ref] || []`。空数组分配在 V8 下很便宜（实测 0.4ns），不建议为此引入共享数组；但要保证 `Overmind.cache` 在调用时已初始化。 |
| `serialize` | 死代码 | 全仓库没有调用者（只有 d.ts 声明）。若没有外部 API 需求可删除；若保留，建议用它替换 `Task` 里手写的 `{pos, ref}`。 |

### 2.6 `RoomPosition.ts`

| 成员 | 结论 | 说明 / 建议 |
| --- | --- | --- |
| `print` / `printPlain` | 保留 | 与 `Room#print` 的 htmllink 逻辑重复，可抽 `roomLink(name)`，低优先级。 |
| `room` / `toCoord` / `readableName` / `isEdge` / `isVisible` / `rangeToEdge` | 保留 | 都是无状态轻量 getter。 |
| `lookForStructure` | 保留 | `lookFor(LOOK_STRUCTURES).find` 正确；如需再快可用 `room.lookForAt(LOOK_STRUCTURES, x, y)`，但要先 profile。 |
| `getOffsetPos` | 保留 | 跨房计算正确（含 W/N 方向、多房偏移）；`Cartographer.findRelativeRoomName` 对非标准房名会抛错（arena/sim），若需要支持需加保护。 |
| `roomCoords` | 优化 | 每次 `RegExp.exec` + `parseInt`；`getMultiRoomRangeTo` 一次调用解析两次。缓存方案见 3.3，实测 59.2ns → 6.7ns。 |
| `neighbors` | 保留 + 说明 | `0 < x && x < 49` 排除了边缘格，和 `getPositionsInRange` 默认 `1..48` 一致，应该是刻意行为；建议在注释里写明，否则看起来像 off-by-one。 |
| `inRangeToPos` / `inRangeToXY` / `getRangeToXY` | 保留 | 手写 abs 避免 `Math.abs` 调用，属于既有微优化；可读性一般但无功能问题。 |
| `getPositionsInRange` | 修复 | y 边界笔误（P0-5）；与 `getPositionsAtRange` 抽公共实现。 |
| `getPositionsAtRange` | 保留 | 外环逻辑正确；与上面统一。 |
| `isWalkable` | 优化 | “wall 地形上有 road 就算可走”是死逻辑（Screeps 不允许在墙上修路），删掉可少一次 `lookForStructure`；可见房间的两次 `lookFor` 可保留（`room.lookAt` 会扫 9 类寄存器，未必更快）。 |
| `availableNeighbors` | 优化 | 见 3.2：先建 8 个 `RoomPosition` + 每格 2 次 `lookFor` + 每格取 terrain；改成一次 terrain + 两个 `lookForAtArea` + 只为可走格建对象。 |
| `getPositionAtDirection` | 保留 / 小改 | 8 分支 switch 可用 `DIRECTION_DX/DY` 常量表替代；非法 direction 目前静默返回原点，建议断言或返回 `undefined`（需评估调用方）。 |
| `getMultiRoomRangeTo` | 优化 | 配合 `roomCoords` 缓存；同房间走 `getRangeTo`，跨房公式正确。 |
| `findClosestByLimitedRange` | 小改 | `findInRange` 已经应用过 filter，再传给 `findClosestByRange` 是重复过滤；可直接 `findClosestByRange(objectsInRange)`。类型上 `opts` 可改用 `FilterOptions`。 |
| `findClosestByMultiRoomRange` | 保留 | 自定义 `minBy` 处理空数组返回 `undefined`，正确。 |
| `findClosestByRangeThenPath` | 修复返回值 | 引擎的 `findClosestByRange` / `findClosestByPath` 在无结果时返回 `null`，而 d.ts 声明 `T | undefined`；空数组时当前实际返回 `null`。建议 `return result ?? undefined`，同时把距离最小值改成单次循环（省一个 `distances` 数组）。 |

### 2.7 `Room.ts`

| 成员 | 结论 | 说明 / 建议 |
| --- | --- | --- |
| `print` | 保留 | 与 `RoomPosition#print` 共用 link 生成逻辑即可。 |
| `my` | 小改 | `this.controller && this.controller.my` 在无 controller 时返回 `null/undefined`，d.ts 写的是 `boolean`。建议 `!!(this.controller && this.controller.my)`。 |
| `isColony` / `isOutpost` | 保留 | 字典查找，O(1)。 |
| `owner` | 小改 | 无 controller 时返回 `null`；建议 `this.controller?.owner?.username`（类型 `string | undefined` 才准确）。 |
| `reservedByMe` / `signedByMe` | 去重 | 两者与 `StructureController` 的同名 getter 重复；`signedByMe` 只比较 text，没有校验 username/time，容易被同文本签名欺骗，而且**当前 0 消费者**。建议 `room.signedByMe` 直接委托 `this.controller?.signedByMe`（含 username + 时效校验），`reservedByMe` 同理。 |
| `creeps` / `hostiles` / `friendlies` / `invaders` / `sourceKeepers` | 保留 | 缓存模式正确（空数组也是 truthy）；`invaders`/`sourceKeepers` 从已缓存的 `hostiles` 派生，没有重复 `find`。 |
| `playerHostiles` | 修复 | P0-1。 |
| `dangerousHostiles` | 优化 | 3 次 `getActiveBodyparts` → 一次 body 反向扫描（见 3.4）；保留 `this.my` 时额外算 WORK 的语义。 |
| `dangerousPlayerHostiles` | 优化 + 修复 | 修好 `isPlayer` 后可直接 `this.dangerousHostiles.filter(c => c.isPlayer)`，省掉第二次 body 扫描。 |
| `fleeDefaults` | 小改 | `(l.ticksToSpawn || Infinity)` 把 `0` 也当“无 spawn”；如果 0 表示本 tick 生成，应该用 `??`。现有单测明确断言 0 被排除（`tests/native-arrays.test.cjs:125-131`），修改时需同步确认语义。 |
| `structures` | 保留 + 注释 | 缓存字段叫 `_allStructures`，注释却写“Hostile structures”；建议改名为 `_structures` 并修正注释。 |
| `hostileStructures` | 保留 | `hitsMax` 过滤 + `isAlly` 排除盟友，正确。 |
| `flags` / `constructionSites` / `allConstructionSites` / `hostileConstructionSites` / `tombstones` / `ruins` | 保留 | 标准 find 缓存。 |
| `drops` / `droppedEnergy` / `droppedPower` | 保留 | `groupBy` 返回 null-prototype 字典，消费方 `|| []` 安全；空数组分配实测很便宜，不必专门优化。 |

### 2.8 `RoomStructures.ts`

| 成员 | 结论 | 说明 / 建议 |
| --- | --- | --- |
| `multipleList` 动态 getter（`spawns`、`extensions`、`roads`、`walls`、`ramparts`、`keeperLairs`、`portals`、`links`、`towers`、`labs`、`containers`、`powerBanks`） | 保留 | IVM 缓存思路正确；`this['_' + type + 's']` 的动态键拼接实测反而比闭包捕获 key 快（1.1ns vs 4.5ns），**不建议改**。注意 `STRUCTURE_WALL === 'constructedWall'`，所以生成属性名是 `constructedWalls`，`walls` 是文件末尾的别名（已确认无缺陷）。 |
| `singleList` 动态 getter（`observer`、`powerSpawn`、`extractor`、`nuker`、`factory`、`invaderCore`） | 保留 | 同上；`invaderCore` 可能属于敌方，和 `repairables` 的交互见下。 |
| `storageUnits` | 保留 | `compact([storage, terminal]).concat(containers)` 正确。 |
| `sources` | 保留 | 已正确缓存（历史上有过“缓存了却返回 `find`”的 bug，`d3bf252` 修过）。 |
| `mineral` | 小改 | 无矿房间每次访问都会重新 `find(FIND_MINERALS)[0]`；可用 `_mineral === undefined` + 哨兵或直接接受（影响很小）。 |
| `repairables` | 修复 | `singleList` 循环没有应用 `notRepairable`，所以 invader core 会被放进来（`worker.ts:74` 的修复任务可能去修敌方 core）；在 singles 循环里加上 `!notRepairable.includes(structureType)`。另外可考虑一次性 `this.structures.filter(...)` 代替多次 `this[type]` + `concat`，减少分配。 |
| `walkableRamparts` | 优化 | 见 3.1；一次 `structures` 扫描 + 一次 terrain + Set 替代“每个 rampart 2 次 `lookFor`”。 |
| `rechargeables` | 类型/语义对齐 | `rechargeObjectType` 类型包含 `StructureLink`，但 getter 只拼 `storageUnits + droppedEnergy + tombstones + ruins`，没有 links。要么把类型收窄，要么明确是否要把 links 算作补给点（links 有 `store`，`recharge.ts` 能处理，但可能和 LinkNetwork 抢能量）。 |
| `barriers` | 保留 | `ramparts + constructedWalls` 语义正确；初版报告的 `undefined` 误报已排除。 |
| `walls` | 保留 | 是 `constructedWalls` 的别名；`STRUCTURE_WALL` 的常量值是 `constructedWall`。 |

其他：`roomStructureIDs` / `roomStructuresExpiration` 以 roomName 为键永久增长。建议在 `_refreshStructureCache` 里顺手清理已过期且不可见的房间条目（每 N tick 扫一次），避免长时间 global 累积。

### 2.9 `RoomVisual.ts`

| 成员 | 结论 | 说明 / 建议 |
| --- | --- | --- |
| 文件头 `import ...;RoomVisual.prototype.infoBox = ...` | 修格式 | 第 2 行 import 和语句挤在同一行，是合并事故；拆行。 |
| `infoBox` / `multitext` | 去重 | 两者 ~40 行逻辑几乎相同（默认值、fontstring、逐行 text）。抽 `drawTextLines(lines, x, y, fontstring, opts)`；同时注意 `defaults(opts, ...)` 会修改调用方传入的对象（只填 undefined，风险低，但可克隆）。 |
| `box` | 优化 | 4 次 `line` → 1 次 `poly`（闭合 5 点）。视觉意图数从 4 降到 1。 |
| `structure` | 保留 / 小改 | `switch` 里 `const storageOutline`、`let outline` 没有块作用域，lint 会报 `no-case-declarations`；建议每个 case 加 `{}`。`roads` 是自定义实例字段，`d.ts` 未声明，补 `roads?: [number, number][]`。 |
| `connectRoads` | 优化 | 当前对每条 road 用 `.some` 扫全部 roads，500 条路约 44 万 ns；Set 化后 2.8 万 ns（约 16×）。见 3.5。返回值在无 roads 时是 `undefined`，与 `RoomVisual` 链式风格不一致，可返回 `this`。 |
| `speech` / `animatedPosition` | 保留 | 逻辑清晰；`animatedPosition` 的 `let radius` 可 `const` 后局部改写。 |
| `test` | 删除 | 开发用 demo，会 `clear()` 当前房间视觉，生产 bundle 不需要；如要保留用 `Memory.settings.debug` 守卫。 |
| `resource` | 小改 | 每次调用新建 7 元素矿物数组；hoist 成模块级常量。 |
| `_fluid` / `_mineral` / `_compound` | 保留 | 颜色表查表正确。 |
| `relPoly` | 小改 | 当前 `map` 里原地修改点数组；现有调用都传新字面量所以没 bug，但这是容易踩的副作用。改成 `poly.map(([px, py]) => [px + x, py + y])` 更安全。 |

### 2.10 `Structures.ts`

| 成员 | 结论 | 说明 / 建议 |
| --- | --- | --- |
| `Structure#isWalkable` | 优化 | 按 id 的 `PERMACACHE` 缓存只映射 structureType（road/container/portal），实测直接比较（4.5ns）比缓存查找（5.7ns）更快且不涨堆；rampart 本来就没缓存。建议直接类型判断 + rampart 特判，并去掉 `(<StructureRampart>this.my \|\| ...)` 这种把 boolean 强转成 StructureRampart 的写法。 |
| `OwnedStructure#_isActive` | 删除 | `OwnedStructure.prototype._isActive = OwnedStructure.prototype.isActive` 之后从未使用；下面 20 行注释掉的自定义 `isActive` 也没有启用。`_isActive` 在 d.ts 里是幻影声明（`@types/screeps` 的 `isActive` 是方法），建议连同注释一起删除。 |
| 6 组 `isFull` / `isEmpty`（Container/Extension/Link/Spawn/Storage/Terminal/Tower） | 合并 | 逻辑重复 6 次，且 `storeCapacity` 已被官方标记 deprecated（engine 仍提供 alias）。建议抽 `defineStoreGetters(ctor)`，用 `store.getFreeCapacity() === 0` / `store.getUsedCapacity() === 0`；对 Container/Storage/Terminal 的 `energy` 也统一成 `store.getUsedCapacity(RESOURCE_ENERGY)`。注意这些结构的容量都 > 0，不会遇到 `getUsedCapacity()` 返回 `null` 的边界。 |
| `StructureLink#storeCapacity` | 保留 / 迁移 | 统一改用 `store.getCapacity()` 后可以删除这个 alias；目前还有消费方（`upgradeSite.ts:134/140` 的 `battery.storeCapacity` 是 container，不是 link），先保留也无害。 |
| `StructureController#reservedByMe` / `signedByMe` / `signedByScreeps` / `needsReserving` | 保留 | 逻辑正确；`signedByMe` 有 username + text + 时效校验，比 `Room#signedByMe` 更严谨。建议 `Room` 的两个 getter 委托到这里，消除双实现。 |
| `Store#contents` | 保留 | `Object.entries(this)` 只取资源键（`getCapacity` 等方法不可枚举），正确；`transferAll` / `withdrawAll` / `AnyZerg` 都在用。 |
| `StructureContainer#energy` / `StructureStorage#energy` / `StructureTerminal#energy` / `Tombstone#energy` | 保留 / 统一 | engine 的 Store Proxy 对缺失资源返回 0，所以目前不会 `undefined`；统一成 `store.getUsedCapacity(RESOURCE_ENERGY)` 更直观。 |
| `StructureTerminal#isReady` / `hasReceived` | 保留 | `_notReady` / `_hasReceived` 是“同 tick 防重复发送”的必要状态；`cooldown` 在本 tick 内可能还没更新，不能只靠它。依赖 P0-3 的补丁修复后，市场成交路径才可靠。 |
| `StructureTerminal#send` 补丁 | 保留 | `_terminalSend.call(this, ...)` 保留了 `this`，且在原型上跨 tick 有效；这是正确的猴子补丁写法。可把 `(<any>...)._hasReceived` 改成 d.ts 字段。 |

---

## 3. 性能与内存优化（按收益排序）

> 下面的 ns 数字是 Node 24 合成微基准，主要衡量 **JS 循环 / 分配 / 正则** 的相对差异；engine 原生调用和 `wrapFn` 的真实成本没有精确建模。上线前建议用 `screeps-profiler` 或 `Game.cpu.getUsed()` 在真实房间验证。

### 3.1 `Room.walkableRamparts`：一次结构扫描替代逐 rampart 查询

现状：每个 rampart 调 `r.pos.isWalkable(true)`，内部要取 terrain + `lookFor(LOOK_STRUCTURES)`，50 个 rampart 约 2.88µs（合成）。

```ts
Object.defineProperty(Room.prototype, 'walkableRamparts', {
	get() {
		if (!this._walkableRamparts) {
			this._refreshStructureCache();
			const cached = roomStructureIDs[this.name].walkableRamparts;
			if (cached) {
				this._walkableRamparts = compact(cached.map(id => Game.getObjectById(id)));
			} else {
				const terrain = Game.map.getRoomTerrain(this.name);
				const blocked = new Set<number>();
				for (const structure of this.structures) {
					if (!structure.isWalkable) {
						blocked.add(structure.pos.y * 50 + structure.pos.x);
					}
				}
				const walkable = this.ramparts.filter(r => r.isWalkable
					&& terrain.get(r.pos.x, r.pos.y) !== TERRAIN_MASK_WALL
					&& !blocked.has(r.pos.y * 50 + r.pos.x));
				roomStructureIDs[this.name].walkableRamparts = walkable.map(r => r.id);
				this._walkableRamparts = walkable;
			}
		}
		return this._walkableRamparts;
	},
	configurable: true,
});
```

注意：`this.structures` 是已缓存的 `find(FIND_STRUCTURES)`；`structure.isWalkable` 对 rampart 走 `my || isPublic`，对其它结构是静态类型判断。结果与 `pos.isWalkable(true)` 等价（除“墙上修路”这一不可能场景）。合成基准 50 个 rampart：**2.88µs → 188ns**。如果对 rampart 数量变化敏感，可在 `roomStructureIDs` 里记录数量做失效条件（参考 `MatrixLib.getRampartMask` 的 `invalidateCondition`）。

### 3.2 `RoomPosition.availableNeighbors`：一次 area 查询 + 只为可走格分配

现状：`neighbors` 先创建 8 个 `RoomPosition`，再对每个调 `isWalkable`（8 次 terrain 获取 + 16 次 `lookFor`）。合成基准 8 格：**680ns → 399ns**（未计原生调用差异）。

```ts
RoomPosition.prototype.availableNeighbors = function(ignoreCreeps = false): RoomPosition[] {
	const room = Game.rooms[this.roomName];
	if (!room) {
		return this.neighbors.filter(pos => pos.isWalkable(ignoreCreeps)); // 不可见：只能看地形
	}
	const terrain = Game.map.getRoomTerrain(this.roomName);
	const top = Math.max(0, this.y - 1), left = Math.max(0, this.x - 1);
	const bottom = Math.min(49, this.y + 1), right = Math.min(49, this.x + 1);
	const blocked = new Set<number>();
	for (const {x, y, structure} of room.lookForAtArea(LOOK_STRUCTURES, top, left, bottom, right, true)) {
		if (!structure.isWalkable) blocked.add(y * 50 + x);
	}
	if (!ignoreCreeps) {
		for (const {x, y} of room.lookForAtArea(LOOK_CREEPS, top, left, bottom, right, true)) {
			blocked.add(y * 50 + x);
		}
	}
	const result: RoomPosition[] = [];
	for (const dx of [-1, 0, 1]) {
		for (const dy of [-1, 0, 1]) {
			if (dx == 0 && dy == 0) continue;
			const x = this.x + dx, y = this.y + dy;
			if (x < 1 || x > 48 || y < 1 || y > 48) continue; // 保持原 neighbors 的边缘语义
			if (blocked.has(y * 50 + x)) continue;
			if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
			result.push(new RoomPosition(x, y, this.roomName));
		}
	}
	return result;
};
```

相比现状：8 次 terrain → 1 次；16 次单点 `lookFor` → 2 次 area 查询；8 个 `RoomPosition` 分配 → 只分配可走格。

### 3.3 多房间距离：缓存 `roomCoords`

`getMultiRoomRangeTo` 在 `LogisticsNetwork`、`RoadLogistics`、`Colony` 资产排序、`recharge` 中调用很频繁，跨房时每次解析两个房名。正则解析实测 **59.2ns → 6.7ns**（缓存命中）。

```ts
PERMACACHE.roomCoords = PERMACACHE.roomCoords || {};
Object.defineProperty(RoomPosition.prototype, 'roomCoords', {
	get() {
		const cached = PERMACACHE.roomCoords[this.roomName];
		if (cached) return {x: cached.x, y: cached.y}; // 保持每次返回新对象
		const parsed = /^([WE])(\d+)([NS])(\d+)$/.exec(this.roomName);
		const coords = parsed
			? {x: (parsed[1] == 'W' ? -1 : 1) * +parsed[2], y: (parsed[3] == 'N' ? -1 : 1) * +parsed[4]}
			: {x: 0, y: 0}; // 非标准房名（arena/sim）不再抛错；如需严格可改为显式报错
		PERMACACHE.roomCoords[this.roomName] = coords;
		return {x: coords.x, y: coords.y};
	},
	configurable: true,
});
```

`Cartographer.getRoomCoordinates` 也是同样的正则，建议一并缓存/复用，避免两套解析。

### 3.4 `dangerousHostiles`：一次 body 扫描 + 派生 player 列表

engine 的 `getActiveBodyparts` 是 JS 函数，内部从 body 末尾向前扫、遇到第一个 `hits <= 0` 就 `break`（`@screeps/engine@4.3.2/src/game/creeps.js:9-18,589`）。当前每个 hostile 最多调 3 次，`dangerousPlayerHostiles` 又对 player 列表重扫一遍。合成基准 20 个 creep：**923ns → 81ns**。

```ts
function hasDangerousPart(creep: Creep, includeWork: boolean): boolean {
	const body = creep.body;
	for (let i = body.length - 1; i >= 0; i--) {
		const part = body[i];
		if (part.hits <= 0) break; // 与 engine getActiveBodyparts 的截断语义一致
		if (part.type == ATTACK || part.type == RANGED_ATTACK || (includeWork && part.type == WORK)) {
			return true;
		}
	}
	return false;
}

// dangerousHostiles
this._dangerousHostiles = this.hostiles.filter((creep: Creep) => hasDangerousPart(creep, !!this.my));

// dangerousPlayerHostiles：不再重复扫 body
this._dangerousPlayerHostiles = this.dangerousHostiles.filter((creep: Creep) => creep.isPlayer);
```

### 3.5 `RoomVisual.connectRoads`：Set 替代 O(n²)

500 条 road：**442.8µs → 27.6µs（约 16×）**。

```ts
RoomVisual.prototype.connectRoads = function(opts = {}): RoomVisual {
	defaults(opts, {opacity: 0.5});
	const color = opts.color || colors.road || 'white';
	if (!this.roads) return this;
	const roadSet = new Set<number>();
	for (const r of this.roads) roadSet.add(r[0] * 50 + r[1]);
	for (const r of this.roads) {
		for (let i = 1; i <= 4; i++) {
			const d = dirs[i];
			if (roadSet.has((r[0] + d[0]) * 50 + (r[1] + d[1]))) {
				this.line(r[0], r[1], r[0] + d[0], r[1] + d[1], {color, width: 0.35, opacity: opts.opacity});
			}
		}
	}
	return this;
};
```

### 3.6 已测量、但不建议改的项

- `RoomStructures` 的 `this['_' + type + 's']` 动态键：实测 1.1ns，闭包 key 4.5ns，保持现状。
- `RoomObject#targetedBy` 的空数组：V8 下 `|| []` 0.4ns，共享空数组反而 4.1ns（变量查找），不必改。
- `Room.droppedEnergy` 的空数组分配同理，收益可以忽略。
- `RoomStructures` 的 `walls` / `constructedWalls` 已用 `STRUCTURE_WALL === 'constructedWall'` 的实际常量确认，不需要改；不要再按“未定义字段”处理。

### 3.7 `PERMACACHE` 的堆增长

| 缓存 | 现状 | 建议 |
| --- | --- | --- |
| `PERMACACHE.bodypartCounts[creepId]` | 每个见过的 creep 永久保留（含敌方侦察到的 creep）；global 不重置时单调增长 | 保留（身体扫描比缓存贵）；可加 tick 戳 + TTL（如 1000 tick 后重算），或只在 `Game.creeps` 的己方 creep 上使用 perma、对敌方用临时缓存 |
| `PERMACACHE.isPlayer[creepId]` | 每个见过的 creep 永久保留 | 直接计算（4.9ns vs 6.2ns），删除缓存（P0-1 的修复会顺带解决） |
| `PERMACACHE.structureWalkability[structureId]` | 每个见过的结构/工地永久保留 | 直接类型判断（4.5ns vs 5.7ns），删除缓存 |
| `roomStructureIDs` / `roomStructuresExpiration` | 每个见过的房间永久保留 | 在 `_refreshStructureCache` 里定期清理过期键；每个房间的结构 id 数组在不可见后没有保留价值 |

---

## 4. 类型声明与 API 一致性

`tsconfig` 开了 `noImplicitThis: false`，原型 getter 里的 `this` 实际是 `any`，所以很多内部缓存字段/幻影字段都能通过类型检查。这也是 `isHuman` 这类幻影字段能长期潜伏的原因之一。建议至少把“跨文件契约”相关的字段声明齐全：

| 位置 | 问题 | 建议 |
| --- | --- | --- |
| `Creep` | `isHuman: true` 是幻影；`isPlayer` 未声明 | 删 `isHuman`，补 `isPlayer: boolean` |
| `Creep` | `_boosts` / `_boostCounts` / `_moveSpeed` / `_inRampart` 未声明 | 补内部字段（可选） |
| `Room` | `constructedWalls` 由 `multipleList` 生成，`walls` 是其别名 | 无需改动；已用真实常量确认 |
| `Room` | `my: boolean` / `owner: string \| undefined` 与实际 `null` 可能不符 | 实现里用 `!!` / 可选链修正 |
| `Room` | `_creeps`、`_hostiles`、`_allStructures` 等缓存字段未声明 | 补声明，顺便把 `_allStructures` 改名 `_structures` |
| `RoomVisual` | `roads` 自定义字段未声明 | 补 `roads?: [number, number][]` |
| `StructureTerminal` | `_notReady` / `_hasReceived` 未声明，代码里用 `<any>` 绕过 | 补可选字段，去掉 `<any>` |
| `OwnedStructure` | `_isActive()` 是死代码声明 | 删除 |
| `RoomPosition` | `lookFor` 重复声明（`@types/screeps` 已有同样的泛型签名），参数名还叫 `structureType` | 删除本地声明，依赖官方类型 |
| `RoomPosition` | `findClosestByRangeThenPath` 实现返回 `T`，声明 `T \| undefined`，实际可能 `null` | 统一为 `T \| undefined` 并 `?? undefined` |
| `Creep` | `approxMoveSpeed` 无消费者 | 删声明 + 实现 + 测试，或真正接入移动估算 |
| `RoomObject` | `serialize` 无消费者 | 删声明 + 实现，或替换现有手写序列化 |
| `Structure` | `storeCapacity` 已 deprecated | 逐步迁移到 `store.getCapacity()` / `getFreeCapacity()`；保留 alias 兼容期 |
| `Room` | `rechargeables` 类型含 `StructureLink`，实现不含 | 收窄类型或补 links（需确认 LinkNetwork 语义） |
| `String` / `Number` | `padRight`/`padLeft` 与原生重复，且是可枚举原型属性 | 换 `padEnd`/`padStart` 并删除；如保留用 `Object.defineProperty` |

另外：

- `Room.signedByMe` 目前 0 消费者且只校验 text；`StructureController.signedByMe` 才是完整校验。建议保留一份实现（委托）。
- `RoomObject#ref` 对 Flag 使用 name，`GameCache.targets` 用普通 `{}` 作字典；flag 名若为 `__proto__`/`constructor` 会命中原型链。建议把 `targets` 改成 `Object.create(null)`（`caching/GameCache.ts:50`）。这个问题不限于 prototypes，但 ref 的契约在这里。
- `RoomVisual#infoBox` / `multitext` 的 `defaults(opts, ...)` 会修改调用方对象；如果调用方复用同一个 opts 对象，后续调用会继承上一次的默认值。只填 undefined，实际风险低，建议顺手改成 `opts = {...defaults, ...opts}`。

---

## 5. 测试建议

评审时 88 个单测全部通过，但两个 P0（`isPlayer`、`Game.market.deal`）都没有覆盖；实施后补了对应测试，总数 95：

1. **P0-1**：`tests/native-arrays.test.cjs:116` 的假 creep 自己加了 `isHuman`，把生产契约掩盖了。改为断言 `Creep.prototype.isPlayer` 存在、`isHuman` 不存在，并让 `Room` 的 fixture 使用 `isPlayer`；最好把 `Creep.ts` 和 `Room.ts` 一起加载，验证跨文件契约。
2. **RoomStructures 防回归**：新增 `tests/prototypes-regressions.test.cjs`，用 stub globals 加载 `RoomStructures.ts`，断言：
   - `room.walls` 与 `room.constructedWalls` 指向同一个生成缓存（`STRUCTURE_WALL === 'constructedWall'`）；
   - `room.barriers` 不含 `undefined`，且包含全部 ramparts + walls；
   - `room.repairables` 不含 invader core；
   - `room.walkableRamparts` 排除墙地形和被其他结构占据的格子。
3. **P0-3**：把 `patchMarketDeal` 导出后，用两个不同的 fake `Game.market` 对象模拟连续两个 tick，断言每个 tick 的 deal 都被包裹、`original.call` 的 `this` 是 market。
4. **P0-4**：`(-1.2345).truncate(2) === -1.23`、`(1e-7).truncate(2) === 0`、`(123.999).truncate(2) === 123.99`。
5. **P1**：`walkableRamparts` 与“逐 rampart `pos.isWalkable`”的朴素实现在随机房间上结果一致；`availableNeighbors` 与旧实现结果一致（包括边缘格、友方/敌方 creep、rampart、墙地形）。
6. **P2**：`Room.fleeDefaults` 的 `ticksToSpawn === 0` 语义需要测试明确（当前测试断言排除 0）。

---

## 6. 建议实施顺序

1. **P0（一个 PR）**：`isPlayer` 契约 + `truncate` + `getPositionsInRange` + `Game.market.deal` 每 tick 安装 + 对应回归测试。
2. **P0-3**：`Game.market.deal` 每 tick 安装 + `this` 修复（可与 1 合并，但涉及 `main.ts`，建议单独 commit 方便回滚）。
3. **P1 性能**：先 `walkableRamparts`、`dangerousHostiles`、`roomCoords`，再 `availableNeighbors`；每项都用 profiler 验证后再合并。
4. **P2 清理**：`PERMACACHE` 收缩、`Structures.ts` store mixin、`PowerCreep.ts` 删除注释、`RoomVisual` 格式/去重、d.ts 补齐。
5. **最后**：考虑把 `PERMACACHE` 内部的 `isPlayer`、`structureWalkability` 删除，只保留 `bodypartCounts`，并给 `RoomStructures` 的房间缓存加清理。

---

## 7. 实施记录（2026-10-30）

**已落地并验证**

- P0-1：`Creep.isPlayer` 改为直接比较并成为唯一契约；`Room.playerHostiles` / `dangerousPlayerHostiles` 使用它；`dangerousHostiles` 改为一次 body 反向扫描，`dangerousPlayerHostiles` 由它派生。`prototypes.d.ts` 删除 `isHuman`、补 `isPlayer`；测试 fixture 与新契约对齐。
- P0-3：`Game.ts` 导出 `patchMarketDeal()`，由 `main()` 每 tick 调用；用 `original.call(Game.market, ...)` 保留 `this`；`_notReady` 加入 d.ts。
- P0-4：`Number#truncate` 改为 `Math.trunc` 算术实现，保留符号并处理指数形式。
- P0-5：`getPositionsInRange` / `getPositionsAtRange` 的 y 边界改为 `ymin/ymax`。
- P1：`walkableRamparts` 改为一次 `structures` 扫描；`availableNeighbors` 改为 area 查询（无 `lookForAtArea` 时回退旧路径）；`roomCoords` 缓存；`repairables` 排除 `notRepairable` 的 singles（含 invader core）；`Structure#isWalkable` / `ConstructionSite#isWalkable` 去掉按 id 的 PERMACACHE；`connectRoads` 改为 Set；`RoomVisual#box` 改为单次 `poly`；`relPoly` 改为无副作用；`PERMACACHE.isPlayer` / `structureWalkability` 删除。
- P2：删除 `PowerCreep.ts` 的 95 行废弃注释；删除 `OwnedStructure._isActive` 死代码；`Room.my/owner/reservedByMe/signedByMe` 修正返回值/委托到 controller；`RoomPosition.lookFor` 重复声明删除；`findClosestByRangeThenPath` 返回 `T | undefined` 并单次求最小距离；`findClosestByLimitedRange` 去掉重复过滤；`String#padRight/padLeft` 删除并改用原生 `padEnd/padStart`；`Number#toPercent/truncate` 改为不可枚举定义；`RoomVisual#roads`、`StructureTerminal#_notReady/_hasReceived` 补 d.ts。
- P0-2：初版报告的 `constructedWalls` 误报已确认并回退，报告中保留说明，避免后续再按错误结论修改。

**保留 / 未落地（有明确理由）**

- `Structures.ts` 的 6 组 `isFull`/`isEmpty` 合并、`storeCapacity` → `store.getCapacity()`：需要覆盖 Link/Spawn/Tower 的差异，建议单独 PR。
- `Creep.inRampart` 按 tick 缓存：`move()` 后 `pos` 可能变化，需先确认引擎行为，暂不缓存。
- `Room.fleeDefaults` 的 `ticksToSpawn || Infinity` → `??`：会改变 `0` 的语义，现有测试明确断言排除 0，先保持。
- `RoomStructures` 房间缓存清理、`RoomObject.serialize` / `ApproxMoveSpeed` / `RoomVisual.test` 删除：涉及外部 API 或收益有限，留待后续清理。
- `RoomVisual#infoBox` / `multitext` 去重：纯维护性改动，未在本轮展开。

**验证结果**

- `npx tsc --noEmit -p .`：通过。
- `npm run lint`：通过。
- `npm run test:unit`：95/95 通过（新增 7 个回归测试：`isPlayer` 契约、`availableNeighbors` area 路径、`truncate`、`patchMarketDeal`、`walls/constructedWalls/barriers`、`walkableRamparts`、`repairables`）。
- `npm run test:bundle`：6/6 通过；Rolldown bundle 约 1,117 kB。
- 未做 live server 部署；性能建议仍需用 `screeps-profiler` 在真实房间复核。

---

## 附录 A：微基准方法与原始数据

环境：Node v24.18.0，Apple M4，`performance.now()`，先 warmup 再取平均；脚本为一次性合成基准，未提交到仓库。

| 场景 | 现状 | 建议 | 说明 |
| --- | ---: | ---: | --- |
| `connectRoads`，500 roads | 442,780 ns | 27,599 ns | O(n²) `.some` → `Set` |
| `dangerousHostiles`，20 creeps | 923.4 ns | 81.5 ns | 3× body 扫描 → 1× 反向扫描（模拟 `getActiveBodyparts`） |
| `walkableRamparts`，50 ramparts | 2,876.7 ns | 188.0 ns | 每 rampart 查询 → 一次 structures 扫描（模拟） |
| `availableNeighbors`，8 格 | 680.5 ns | 399.1 ns | 逐格查询 → area 查询（模拟） |
| `Number#truncate`，5 个样本 | 300.3 ns | 62.4 ns | 正则 → 算术 |
| `roomCoords` | 59.2 ns | 6.7 ns | 正则解析 → 缓存 |
| `isPlayer` | 6.2 ns | 4.9 ns | perma 缓存 → 直接比较 |
| `structureWalkability` | 5.7 ns | 4.5 ns | per-id 缓存 → 直接比较 |
| `RoomStructures` 动态键 | 1.1 ns | 4.5 ns | 现状更快，保持 |

> 这些数字只用于判断“是否值得改”；engine 的原生调用、`wrapFn` 包装、CPU 计量都不在模型内。真实收益以 `screeps-profiler` 为准。

## 附录 B：已确认没有问题的点（避免重复排查）

- `RoomStructures` IVM 缓存结构、`getCacheExpiration` 随机偏移、`Game.getObjectById` + `compact` 过滤已销毁对象。
- `Creep.approxMoveSpeed` 的反向求和是有意为之：Lodash 3 的 `_.sum` 对数组确实逆序迭代（已用 `tests/helpers/screeps-lodash.cjs` 验证），现有热路径测试也覆盖了。
- `Creep.boosts` / `boostCounts` / `bodypartCounts` 的缓存身份、空 body、NaN/Infinity 边界都有测试。
- `Room` 的 `creeps` / `hostiles` / `friendlies` 等 find 缓存模式正确；空数组 truthy，不会重复 find。
- `StructureTerminal#send` 的 prototype 补丁保留 `this`，跨 tick 有效，写法正确。
- `RoomPosition#getOffsetPos` 的跨房计算（W/N 方向、多房偏移）正确。
- `RoomVisual` 的颜色表、resource 绘制、`defaults` 的默认值填充逻辑没有发现错误。
