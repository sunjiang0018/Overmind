<img src="/assets/img/OvermindLogo.png" width=825>

[<img src="/assets/img/buttons/download.png" height=22>](https://github.com/bencbartlett/Overmind/releases) [<img src="/assets/img/buttons/patchNotes.png" height=22>](https://github.com/bencbartlett/Overmind/blob/master/CHANGELOG.md) [<img src="/assets/img/buttons/documentation.png" height=22>](https://bencbartlett.github.io/overmind-docs/) [<img src="/assets/img/buttons/wikipages.png" height=22>](https://github.com/bencbartlett/Overmind/wiki) [<img src="/assets/img/buttons/slack.png" height=22>](https://screeps.slack.com/messages/overmind) [<img src="/assets/img/buttons/issue.png" height=22>](https://github.com/bencbartlett/Overmind/issues/new) [<img src="/assets/img/buttons/featureRequest.png" height=22>](https://github.com/bencbartlett/Overmind/issues/new?template=feature_request.md)

### Current release: [Overmind v0.5.2 - Evolution](https://github.com/bencbartlett/Overmind/releases) [![Build Status](https://travis-ci.org/bencbartlett/Overmind.svg?branch=master)](https://travis-ci.org/bencbartlett/Overmind)

- See the [changelog](https://github.com/bencbartlett/Overmind/blob/master/CHANGELOG.md) for patch notes
- Documentation is available at the [documentation site](https://bencbartlett.github.io/overmind-docs/) and the [wiki](https://github.com/bencbartlett/Overmind/wiki)
- Join the discussion in the [#overmind](https://screeps.slack.com/messages/overmind) Slack channel!
- Read [blog posts](https://bencbartlett.wordpress.com/category/screeps/) about development
- Submit an issue [here](https://github.com/bencbartlett/Overmind/issues/new) or request a feature [here](https://github.com/bencbartlett/Overmind/issues/new?template=feature_request.md)
- Find me in game [here](https://screeps.com/a/#!/profile/Muon)

---

# About Overmind

<img align="right" src="/assets/img/exampleRoomBanner2.png" width=325>

### What is Screeps?

Screeps is an [MMO strategy game for programmers](https://screeps.com/). The core objective is to expand your colony, gathering resources and fighting other players along the way. To control your units, you code an AI in JavaScript; everything from moving, mining, building, fighting, and trading is entirely driven by your code. Because Screeps is an MMO, it takes place on a single server that runs 24/7, populated by every other player and their army of creeps. When you log off, your population continues buzzing away with whatever task you set them. Screeps pits your programming prowess head-to-head with other people to see who can think of the most efficient methods of completing tasks or imagine new ways to defeat enemies.

### What is Overmind?

Overmind is my personal codebase that I run on the public server. The structure of the AI is themed loosely around the [Zerg's swarm intelligence](http://starcraft.wikia.com/wiki/Overlord) from Starcraft. [Overlords](https://github.com/bencbartlett/Overmind/blob/master/src/overlords/Overlord.ts) orchestrate Creep actions within each [Colony](https://github.com/bencbartlett/Overmind/blob/master/src/Colony.ts), and the colony [Overseer](https://github.com/bencbartlett/Overmind/blob/master/src/Overseer.ts) places [Directives](https://github.com/bencbartlett/Overmind/blob/master/src/directives/Directive.ts) to adapt to stimuli. The legacy Assimilator collective/checksum feature is disabled in this checkout.

The AI is entirely automated, although it can also run in manual or semiautomatic mode. The [latest release](https://github.com/bencbartlett/Overmind/releases) should work right out of the box; however, if you find something broken, please [submit an issue](https://github.com/bencbartlett/Overmind/issues/new) and I'll try to fix it.

### Can I use Overmind as my bot?

If you're new to Screeps, I would definitely recommend writing your own AI: most of the fun of the game is programming your own bot and watching your little ant farm run! However, I've tried to make the codebase readable and well-documented, so feel free to fork the project or use it as inspiration when writing your AI.

If you still want to use Overmind on the public server, that's okay too - [there are a number of people already doing this](http://www.leagueofautomatednations.com/map/shard2/bots). But please realize that using a mature AI like this gives you a huge advantage over other new players, so don't go out of your way to ruin someone else's fun. In the future, I will be implementing methods for novice players to opt out of excessive aggression by Overmind bots (as long as they don't start a conflict and stay out of its way).

# Installation

### Out of the box

If you just want to run Overmind without modification, you can copy the compiled `main.js` file attached to the [latest release](https://github.com/bencbartlett/Overmind/releases) into your script. While Overmind is fully automated by default, it can be run with varying levels of autonomy; refer to the [Overmind wiki](https://github.com/bencbartlett/Overmind/wiki) for how to configure and operate the bot.

### Compiling from source

Use Node.js 24.11 or newer within the 24.x line (`nvm use`) and pnpm 12.16.1 (`pnpm install --frozen-lockfile`). Versions are recorded in `.nvmrc` and `package.json`. Vite+ 1.5.0 is installed locally; no global CLI is required. To deploy, create a `screeps.json` file from the [example file](https://github.com/bencbartlett/Overmind/blob/master/screeps.example.json), then use one of the following commands:

- Compile and deploy to public server: `npm run push-main`
- Compile and deploy to private server: `npm run push-pserver`
- Compile without deploying: `npm run build`
- Run lint and type checking: `pnpm run check`
- Run all JavaScript tests, including a type-checked build and bundle runtime tests: `pnpm test`
- Generate API documentation in `dist/docs`: `npm run docs`

Vite+ Pack builds a self-contained CommonJS `dist/main.js` exporting `loop`, with Vite+ type checking before bundling. Builds use the default tree shaking and clean the output directory; run `npm run docs` after building if you need to regenerate `dist/docs`. Configuration lives in `vite.config.mjs`. Local builds need no credentials and ignore inherited upload settings; only the explicit deployment commands upload code. The old assimilation checksum system is disabled in this checkout.

Deployment uses the project-owned `scripts/upload.cjs` with Node.js fetch; no Screeps bundler plugin is installed. Existing `push-*` commands build and then upload. To upload an already-built bundle directly, run `node scripts/upload.cjs --destination main` (optionally `--output dist/main.js`). The destination names and credentials still come from `screeps.json`. The uploader supports tokens, private-server email/password authentication, custom server paths, branch creation, and JavaScript/Wasm modules. Failed uploads exit nonzero; requests time out after 30 seconds and are not automatically retried.

Both type checking and bundling use Vite+: `pnpm run typecheck` invokes Vite+'s bundled Go-based TypeScript checker, and `pnpm run build` runs that check followed by `vp pack`. The standalone TypeScript CLI dependency has been removed. Tests, enum generation, and TypeDoc retain the official TypeScript compiler API compatibility package. `typecheck` disables lint rules with `-A all` so it checks types only; `pnpm run check` runs the existing format/lint rules followed by Vite+ type checking. Formatting uses Oxfmt defaults throughout, including TypeScript; the `fmt` block in `vite.config.mjs` only defines ignored files. The `node:test` suite runs through `pnpm test` or `vp run test`. Test fixtures obtain Lodash 3 from `@screeps/common`; the application has no Lodash dependency. The only runtime package dependency is `columnify`, used for logistics console tables.

### Development notes

- `scripts/ambient-enums.cjs` supplies compile-time values for ambient constant enums used as persistent memory keys. Keep its `define` configuration when adjusting the build.
- A custom output is supported with `node scripts/build.cjs --output dist/main.js`. Builds clean the selected output directory, including custom directories.
- Validate the terrain layout with `python3 scripts/plan-e58s42.py --check`. Run the Python layout tests with `python3 -m unittest discover -s tests -p 'test_*.py'`.
- The generated `src/roomPlanner/layouts/E58S42.ts` is excluded from Oxfmt so it continues to match its generator. Vendored/deprecated code and generated assets are also excluded in `vite.config.mjs`.
- Remote debugging evaluates global JavaScript expressions. For multiple statements, use an IIFE with an explicit return, for example `remoteDebugger.debug('(() => { const tick = Game.time; return {tick}; })()')`. It remains capable of arbitrary code execution; only enable a session when you intend to use it.

### Setting up the Grafana dashboard

Overmind includes a [Grafana dashboard](https://github.com/bencbartlett/Overmind/tree/master/assets/Grafana%20Dashboards) (shown below) which tracks detailed operating statistics. To set up the dashboard:

1. Register for grafana service at [screepspl.us](https://screepspl.us/services/grafana)
2. Setup the [ScreepsPlus hosted agent](https://screepspl.us/services/hosted-agent/) (simpler) or use the NodeJS agent [on a free micro instance of Google Compute](https://github.com/bonzaiferroni/bonzAI/wiki/Screepspl.us-agent-with-Compute-Engine).
3. Import the dashboard from [Overmind.json](https://github.com/bencbartlett/Overmind/blob/master/assets/Grafana%20Dashboards/Overmind.json) and change `$User` to your username.
4. Enjoy your pretty graphs!

![](/assets/img/dashboard_compacted_2.png)

# Design overview

Check out the [Overmind wiki](https://github.com/bencbartlett/Overmind/wiki) for in-depth explanations of parts of the design of the AI. (Click the diagram below to see a higher-resolution version.)

[![AI structural schematic](assets/img/AIdiagram.png)](assets/img/AIdiagram.png)
