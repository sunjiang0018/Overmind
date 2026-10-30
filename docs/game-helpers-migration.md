# 游戏对象扩展迁移为显式函数

2026-10-30：原 `src/prototypes` 已迁入 `src/game`。项目内调用方、类型声明和测试同步迁移；`main.ts` 不再安装原型扩展，也不再逐 tick 包装 `Game.market.deal`。

## 调用方式

| 原调用 | 新调用 | 模块 |
| --- | --- | --- |
| `room.hostiles` | `getRoomHostiles(room)` | `src/game/Room.ts` |
| `room.sources` | `getRoomSources(room)` | `src/game/RoomStructures.ts` |
| `room.factory` | `getRoomFactory(room)` | `src/game/RoomStructures.ts` |
| `creep.boosts` | `getCreepBoosts(creep)` | `src/game/Creep.ts` |
| `pos.isEdge` | `isPositionOnEdge(pos)` | `src/game/RoomPosition.ts` |
| `pos.availableNeighbors(true)` | `roomPositionAvailableNeighbors(pos, true)` | `src/game/RoomPosition.ts` |
| `object.ref` | `getRoomObjectRef(object)` | `src/game/RoomObject.ts` |
| `store.contents` | `getStoreContents(store)` | `src/game/Structures.ts` |
| `terminal.isReady` | `isTerminalReady(terminal)` | `src/game/Structures.ts` |
| `terminal.send(...)` | `sendTerminalResources(terminal, ...)` | `src/game/Structures.ts` |
| `Game.market.deal(...)` | `marketDeal(...)` | `src/game/Game.ts` |
| `visual.structure(...)` | `roomVisualStructure(visual, ...)` | `src/game/RoomVisual.ts` |
| `value.truncate(2)` | `truncateNumber(value, 2)` | `src/game/Miscellaneous.ts` |

应用类（如 `Zerg`、`Colony`、`Directive`）自己的 getter 继续存在；这里只移除了游戏对象和 `Number` 的原型扩展。`getRoomObjectRef` 同时支持引擎对象的 `id` / `name` 和应用包装对象自己的 `ref`，任务序列化格式没有变化。

外部脚本若使用这些旧扩展，也需要迁移。发送资源和市场交易应使用显式入口，才能记录本 tick 的终端可用状态；原生方法本身不再被修改。

## 缓存生命周期

- `createTickCache` 使用 `WeakMap`，按对象身份区分实例，并在 `Game.time` 改变时重建缓存。读缓存不向游戏对象添加字段，也支持跨 tick 复用同一实例的运行环境。
- Room / Creep 的缓存容器在创建时按固定顺序初始化字段。空数组、零值和缺失单体建筑也可以复用结果；单体建筑消失时返回 `undefined`。
- 房间建筑 ID 仍按原有超时策略跨 tick 保存；每个 tick 重新解析对应的当前建筑对象。墙、屏障及可维修建筑的分类规则保持原样。
- 身体部件计数和房间坐标继续使用原有 `PERMACACHE`，改为首次调用时初始化。
- 终端发送成功后记录发送方忙碌和可见接收方已接收；交易成功后记录己方终端忙碌。失败不标记，下个 tick 自动失效。
- 绘图道路状态也移入外部缓存，按绘图对象和 tick 隔离。

删除旧 `Store` 扩展声明后，真实引擎 Store 类型恢复生效。普通资源字典改用 `ResourceAmounts`，不再伪装成包含容量方法的 `StoreDefinition`。

## V8 与性能边界

`Object.defineProperty` 并非必然导致隐藏类失效。初始化时定义的稳定原型 getter，与运行时按不同访问顺序添加 `_boosts` / `_boostCounts` 等实例字段，是两种情况。V8 对属性布局和添加顺序的解释见 [Fast properties](https://v8.dev/blog/fast-properties) 和 [Hidden Classes](https://v8.dev/docs/hidden-classes)。

可复现检查：

```sh
node --allow-natives-syntax scripts/benchmark-game-helpers.cjs
```

本地 Node v24.11.1 / V8 13.6.233.10 的一次抽样中，旧缓存以不同顺序读取后 `%HaveSameMap` 为 `false`，新实现为 `true`；只读、无实例写入的原型 getter 本身也保持相同隐藏类。新 creep 实例仍只有原始 `body` 字段。

同一次暖缓存微基准中，旧缓存 getter 约 3.8 ns/次，新外部缓存函数约 7.5 ns/次。该测试只说明对象形状和局部查表成本，不能代表整局收益；尚未测量 Screeps 线上 CPU，也不宣称整体提速。后续应在相同游戏负载下比较 `Game.cpu.getUsed()` 的多 tick 分布。

## 验证

- `npm run typecheck`
- `npm test`：102 项单元测试及 6 项构建 / bundle 测试通过。
- 新增回归覆盖冻结对象上的读取、缓存身份与过期、缺失建筑、终端交易状态、引用序列化、任务目标登记及绘图道路隔离。
