# Overmind：Lodash → es-toolkit 替换评估

研究日期：2026-10-30（Asia/Shanghai）。仅记录评估，未修改业务代码、依赖或构建配置。

> 后续实施记录（2026-10-30）：已分两轮将 49 + 601 处适合的 Lodash 调用替换为原生 JS，未引入 es-toolkit。本报告的用量盘点为迁移前快照。后续原生替换已通过 TypeScript 构建、50 项 Node 测试、9 项 Python 测试及当时的 Rollup 打包；此后构建已迁移到 Rolldown，并移除了 Rollup 构建链。下文 Rollup 配置和实验数据均为历史记录；现行配置见 `rolldown.config.mjs`。CPU 收益仍未在游戏内实测。

## 结论

可以逐步迁移，但本项目不适合将全局 `_` 机械替换为 `es-toolkit/compat`。当前使用 Lodash 3 风格接口；compat 对应的是现代 Lodash 接口，部分旧名称、重载和空集合行为不同。收益应以真实 Screeps CPU 和构建产物为准。

本项目的 Lodash 来自 Screeps 运行环境，用户包没有直接引入 lodash 运行时。Screeps engine 会初始化全局 `_` 并预置 `require('lodash')` 缓存；driver 依赖 `lodash: ^3.10.1`。由此推断，新增 es-toolkit 不会移除服务器预置库，反而新增用户 bundle 代码；官网面向已打包 Lodash 的体积对比不能直接应用。[Screeps engine 初始化源码](https://github.com/screeps/engine/blob/master/src/game/game.js#L439-L470)、[driver package.json](https://github.com/screeps/driver/blob/master/package.json)

## 本地源码盘点

使用仓库 TypeScript 5.3.3 AST 统计实际调用，排除注释、声明文件和混淆文件；依据 `tsconfig.json` 的模块解析规则从 `src/main.ts` 递归跟踪本地静态依赖，并以内存中编译后的 JS 导入图复核，移除仅有类型关系的模块。两种口径的 Lodash 调用计数一致。可达不代表每个 tick 都执行，以下是调用位置数，不是运行次数。

- 全部非混淆源码：128 个文件、1,481 处调用。
- 主入口可达源码：120 个文件、1,408 处调用、63 种 API；下表均使用这一口径。
- `package.json` 只有 `@types/lodash: 3.10.2`，没有运行时 lodash 直接依赖。lockfile 中的 Lodash 4 属于工具依赖，不能据此判断游戏里的 `_` 版本。

| 实际用法 | 位置数 | 迁移含义 |
| --- | ---: | --- |
| `map` / `filter` | 241 / 227 | 大量数组操作适合原生化，但存在对象集合和 shorthand |
| `sum` | 151 | 77 处有 iteratee；其余也包含 Store / 普通字典求和 |
| `forEach` / `find` | 75 / 54 | 需核对数组或对象、返回值及回调行为 |
| `any` / `all` | 36 / 16 | 旧接口需要改名或改成数组原生方法 |
| `unique` | 16 | 10 处无回调，6 处有回调，需要区分 `uniq` / `uniqBy` |
| `min` / `max` | 17 / 24 | 均为单参数，但仍需核对空集合语义 |
| `sample` | 9 | 其中 5 处传入数量，应迁移至 `sampleSize` |
| `contains` / `object` / `padRight` | 4 / 1 / 1 | 对应 `includes` / `zipObject` / `padEnd` |

仅上面的旧别名就涉及 74 处调用，再加 77 处带 iteratee 的 sum 和 5 处带数量的 sample，已有 **156 处明确不能仅替换 import 路径**。其他同名接口也不能由此认定为兼容。

类型检查进一步确认：map 有 233 处数组输入、6 处其他输入、2 处 any，另有 5 处使用非函数的第二参数；filter 有 206 处数组输入、10 处其他输入、11 处 any。sum 有 16 处明确的非数组输入、50 处 any 输入，需人工确认 Store 等运行时对象。这些分类只用于筛选，不能替代逐处语义验证。

具体例子：

- `src/creepSetups/CreepSetup.ts:17`：`_.sum(bodyparts, part => BODYPART_COST[part])` 应考虑 `sumBy` 或循环。
- `src/hiveClusters/sporeCrawler.ts:117`：`_.sample(decayingRoads, this.towers.length)` 返回数组，不能改成只返回单个元素的现代 sample。
- `src/logistics/TradeNetwork.ts:195`：filter 的输入 `Game.market.orders` 是对象，不能直接改成 `Game.market.orders.filter(...)`。
- `src/overlords/core/queen_bunker.ts:150`：`queenCarry` 是模拟资源字典，不能一概改成 `store.getUsedCapacity()`。
- `src/utilities/utils.ts:248,265`：项目自定义 minBy/maxBy 将回调返回 false 解释为“跳过候选”，并非可直接替换的标准 minBy/maxBy。

## 临时隔离实验

通过 npm 将 **Lodash 3.10.1** 和 **es-toolkit 1.53.0** 下载至 `/tmp/overmind-toolkit-eval`，在 Node.js v24.11.1 中对照运行；未向本项目安装依赖。

| 输入 / 调用 | Lodash 3 或项目现有行为 | es-toolkit/compat 或严格入口行为 |
| --- | --- | --- |
| `sum({energy: 30, power: 4})` | 34 | compat sum 返回 0 |
| `sum([{n: 2}, {n: 5}], x => x.n)` | 7 | compat sum 忽略第二参数，得到对象拼接字符串；严格入口 sumBy 返回 7 |
| `min([])` / `max([])` | Infinity / -Infinity | compat 返回 undefined / undefined |
| `sample([1, 2, 3], 2)` | 返回数组 | compat 返回单个值 |
| minBy 的候选分数为 false 与 2 | 项目函数跳过 false，选择分数 2 的候选 | 严格入口选择分数 false 的候选 |

上表是针对选定输入的行为探针，不是完整兼容性测试，也不代表游戏内执行性能。

### 使用当前构建工具测量体积

复用当前安装的 Rollup 2.80.0、node-resolve 7.1.3、commonjs 11.1.0，在临时目录打包一个仅导出 `run(xs)` 的模块，输出 CJS、未压缩、无 sourcemap。用 bare import 经插件解析，并验证生成代码能够求得 7、未遗留外部 es-toolkit require。省略与此实验无关的 TypeScript、progress、上传插件；**不是完整 Overmind 构建前后对比**。

| 临时模块的实现 | treeshake | 产物字节数 | 相对全局 `_` 示例 |
| --- | --- | ---: | ---: |
| `_.sum(xs, x => x.n)` | false | 148 | 基线 |
| `import {sumBy} from 'es-toolkit'` | false（项目当前配置） | 241,104 | +240,956，约 235.3 KiB |
| `import sumBy from 'es-toolkit/compat/sumBy'` | false | 40,184 | +40,036，约 39.1 KiB |
| `import {sumBy} from 'es-toolkit'` | true（假设调整配置） | 926 | +778 |

因此，当前 `rollup.config.js:53` 的 `treeshake: false` 有实质影响。即使只导入一个严格入口函数，也可能带入大量未使用函数。全量迁移的产物不能按“每处增加 235 KiB”相加；依赖会共享，上表只是一个小入口实验。

另外，当前插件组合对 `import {sumBy} from 'es-toolkit/math'` 与 `import {sumBy} from 'es-toolkit/compat'` 均出现“sumBy is not exported”错误，解析到了包的 CommonJS 转发入口；官方单函数 compat 默认导入可成功。实施时应先解决入口解析 / 工具版本问题。严格入口根模块打包有 circular dependency 警告，当前实验仍可运行。

开启 tree-shaking 需要独立检查现有初始化和副作用模块，不能只为获得上表体积而直接修改生产构建配置。

## 版本和两个入口

核验时最新官方 release 为 **v1.53.0，2026-10-24 发布**。该版本特别说明 `es-toolkit/compat` 可以在 Node.js 6 和 ES2015 环境运行，无需转译或 polyfill。因此不能拿旧版“Node.js 18+”说明一概否定 compat；严格入口和具体所用功能仍应单独验证。[官方 releases](https://github.com/toss/es-toolkit/releases/tag/v1.53.0)

`es-toolkit` 提供严格、简化的现代接口；`es-toolkit/compat` 为兼容 Lodash 保留额外分支，体积和运行开销通常高于严格入口。官方建议先通过 compat 过渡，再逐步迁移到严格入口。其“100% compatibility”声明不能解释为兼容全部 Lodash 历史大版本；下表列出的 Lodash 3 接口已经有明确差异。[compat 介绍](https://es-toolkit.dev/compat/intro.html)、[compat 导出源码](https://github.com/toss/es-toolkit/blob/main/src/compat/compat.ts)

## 主要迁移差异

以下是迁移映射，不是可直接批量执行的 codemod；每处仍需核对输入类型、回调与默认值。

| Lodash 3 调用 | 迁移方向 | 注意点 |
| --- | --- | --- |
| `_.sum(array, f)` | 严格入口 `sumBy(array, f)` | compat `sum` 只接收数组，不接受 iteratee |
| `_.sum(record)` | 先明确对象求和语义；数字字典可用 `sum(Object.values(record))` | 会产生中间数组；Screeps Store 优先核对 `getUsedCapacity()` 是否符合业务语义 |
| `_.sample(xs, n)` | `sampleSize(xs, n)` | 现代 sample 只返回单项 |
| `_.unique(xs, f)` | `uniqBy(xs, f)` | 无回调时可用 uniq；对象引用相等与业务主键相等不可混淆 |
| `_.min/max(collection, f)` | `minBy/maxBy(array, f)` | 对象集合须先处理；空集合结果由 ±Infinity 改为 undefined |
| `_.min/max(numberArray)` | 小数组可用 `Math.min/max(...array)`；大数组考虑循环 | 严格入口没有普通 number 的 min/max；compat 版本为空返回 undefined |
| `_.any/all` | 数组原生 `some/every` 或 compat `some/every` | 严格入口并非通用对象集合 API；原生方法对空槽、回调 shorthand 的处理需核对 |
| `_.contains` | 数组/字符串原生 `includes` 或 compat `includes` | 对象集合的 includes 不能直接改成对象实例方法 |
| `_.pluck(xs, path)` | 数组原生 `map` 或 compat `map(xs, path)` | 深路径、缺失值要保留原含义 |
| `_.where(xs, source)` | compat `filter(xs, source)` 或显式 predicate | 深层匹配应核对测试 |
| `_.indexBy(xs, key)` | `keyBy` | 严格入口需要函数形式时改成显式回调 |
| `_.object(keys, values)` | `zipObject(keys, values)` | pairs 形式另查 `fromPairs` |
| `_.sortByOrder(xs, iteratees, orders)` | `orderBy` | 检查旧布尔 orders；现代接口应显式使用 asc/desc |
| `_.create(proto, props)` | compat `create`；或明确构造原型后赋普通属性 | 不能直接写成 `Object.create(proto, props)`：原生第二参数是属性描述符；compat `create(null)` 得到普通对象，不等同原生 null 原型对象 |

Lodash 3 的 `sum` 支持对象、iteratee 和 thisArg；`min/max` 支持 iteratee，空集合分别返回 Infinity / -Infinity。[Lodash 3.10.1 文档](https://lodash.com/docs/3.10.1#sum)

compat `sum` 只接受 ArrayLike/null/undefined；compat `max` 空数组返回 undefined。[compat sum](https://es-toolkit.dev/compat/reference/math/sum.html)、[compat max](https://es-toolkit.dev/compat/reference/math/max.html)

严格入口提供数组 `sumBy`、`minBy`，后者空数组返回 undefined；number math 导出没有 min/max。[sumBy](https://es-toolkit.dev/reference/math/sumBy.html)、[minBy](https://es-toolkit.dev/reference/array/minBy.html)、[math 导出源码](https://github.com/toss/es-toolkit/blob/main/src/math/index.ts)

`create` 的 null 原型和普通属性复制行为需要保留。[compat create](https://es-toolkit.dev/compat/reference/object/create.html)

## 能期待的收益

**CPU：可能有局部收益，尚不能承诺整 tick 的百分比。** 官方性能页当前测试环境是 Apple M4、Node.js v22.23.2，对比 es-toolkit 1.52.0 与 Lodash 4.18.1，存在函数提升也存在退步（示例 union 为 0.9×）。这与项目的 Lodash 3、Screeps isolate、集合规模和调用分布不同。[官方性能测试](https://es-toolkit.dev/performance.html)

举例：若可替换调用只占 tick CPU 的 10%，且这部分实测快 2×，整 tick 也只减少约 5%。这是示例计算，不是本项目测量结果。业务算法、缓存、减少遍历和临时数组通常比函数名替换更值得先测。

**体积：相对当前基线很可能增加。** 官网体积表是用 esbuild 构建单函数导入，与 lodash-es 比较；不是与服务器已有全局 `_` 比较。[官方体积测量方法](https://es-toolkit.dev/bundle-size.html)

本地 `rollup.config.js` 还有 `treeshake: false`。从包根进行命名导入并不自动保证只打包这些函数。正式试验需检查实际产物，必要时选择官方支持的单函数 compat 路径（例如 `es-toolkit/compat/merge`），或单独评估开启 tree-shaking 对现有副作用模块的影响。[单函数导入说明](https://es-toolkit.dev/compat/intro.html#importing-individual-functions)

**维护：可以获得显式 imports 和现代 TypeScript 接口。** 但局部迁移仍保留 Screeps 全局 lodash 类型；不能仅因为引入 es-toolkit 就移除全局类型声明。去除旧别名、收紧空值处理和明确 Store 语义是独立的可维护性收益，不必绑定全量迁移。

## 建议验证方式

1. 选择 profiler 显示的热路径，优先替换纯数组操作和重复遍历；简单 map/filter/some/every 可直接使用原生方法。
2. 对 `sum` 的数组/对象/iteratee、min/max 的空集合与 ±Infinity、shorthand、sampleSize、uniqBy、自定义 minBy/maxBy 的 false 哨兵补充有区分力的行为对照。
3. 构建前后记录 `dist/main.js` 字节数和 global reset 首次 tick 的 CPU。
4. 在相同服务器、相似房间/creep 数、相似运行阶段，记录数百至数千 tick 的平均值、分位数和 bucket 变化；用 `Game.cpu.getUsed()` 测局部区间，避免 Simulation 模式（该 API 在其中始终返回 0）。[Screeps CPU API](https://docs.screeps.com/api/#Game.cpu.getUsed)
5. 只有 CPU 收益超过新增 bundle/维护成本，才扩大迁移范围。

## 尚未确认

- 未连接实际 Screeps 实例，未核验目标 shard / 私服的 `_.VERSION`、V8 版本或特性集合。
- 已完成临时包下载、行为探针和小入口打包；未将 es-toolkit 安装至项目、未修改业务代码、未进行完整应用迁移构建或游戏内 A/B，不存在可报告的项目 CPU 改善百分比。
- 上文源码链接中的 main/master 是研究时状态；实施时应固定安装版本并保存具体 commit/lockfile。
- 已观察到当前旧版插件的部分入口解析问题；最终入口方案、实际使用函数是否引用 DOM/计时器等，仍需要以完整产物和目标运行环境实测。
