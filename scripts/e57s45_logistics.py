"""Conservative road-only refill model for the existing mobile Queen.

One transfer or withdrawal per tick, finite carry capacity, nearest-by-range
requests with path-length tie breaking. Empty spawns/extensions, full energy
buffers, no traffic or concurrent spawning. Results are comparisons, not live
server tick predictions. Test both target orders to expose tie sensitivity.
"""
from collections import deque


def near(p):
    return [(p[0] + dx, p[1] + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)
            if (dx or dy) and 0 <= p[0] + dx < 50 and 0 <= p[1] + dy < 50]


def distance(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def refill(plan, level, reverse=False, use_link=False):
    stage = plan["stages"][str(level)]
    points = lambda kind: [(p["x"], p["y"]) for p in stage[kind]]
    extensions, spawns = points("extension"), points("spawn")
    extension_capacity = 50 if level <= 6 else (100 if level == 7 else 200)
    room_energy = 300 * len(spawns) + extension_capacity * len(extensions)
    if level < 4:
        carry_capacity = min(25, room_energy // 100) * 50
    else:
        carry_capacity = min(16, room_energy // 150) * 100
    targets = [(p, 300) for p in spawns] + [(p, extension_capacity) for p in extensions]
    if reverse:
        targets.reverse()
    battery = points("container")[2]
    requested_link = use_link and len(points("link")) >= 5
    buffer_first = plan.get("logisticsPolicy", {}).get("queenBufferFirst", False)
    # The runtime policy picks the full 2000-capacity buffer before an 800
    # link. In this full-buffer benchmark the link remains a fallback only.
    link = points("link")[4] if requested_link and not buffer_first else None
    energy_source = link or battery
    # A live link holds 800; a container holds 2000. Full carry is not assumed
    # when the preferred link cannot provide it in one withdrawal.
    source_capacity = 800 if link else 2000
    walkable = set(points("road")) | {battery}
    manager = (plan["managerPosition"]["x"], plan["managerPosition"]["y"])
    walkable.discard(manager)
    pos, energy, movement, transfers, withdrawals = battery, 0, 0, 0, 0
    searches = {}

    def paths(start):
        if start not in searches:
            previous = {start: None}
            distances = {start: 0}
            queue = deque([start])
            while queue:
                p = queue.popleft()
                for n in sorted(near(p)):
                    if n in walkable and n not in previous:
                        previous[n] = p
                        distances[n] = distances[p] + 1
                        queue.append(n)
            searches[start] = distances, previous
        return searches[start]

    def approach(start, target):
        distances, _ = paths(start)
        choices = [p for p in near(target) if p in distances]
        if start == target:
            choices.append(start)
        assert choices, (level, "Unreachable supply target", target)
        return min(choices, key=lambda p: (distances[p], p))

    while targets:
        if energy == 0:
            end = approach(pos, energy_source)
            movement += paths(pos)[0][end]
            pos = end
            energy = min(carry_capacity, source_capacity)
            withdrawals += 1
        nearest = min(distance(pos, p) for p, _ in targets)
        candidates = [(i, p, missing) for i, (p, missing) in enumerate(targets)
                      if distance(pos, p) == nearest]
        if nearest > 4:
            candidates = candidates[:1]
        choices = []
        for i, p, missing in candidates:
            end = approach(pos, p)
            choices.append((paths(pos)[0][end], i, end, missing))
        steps, index, end, missing = min(choices)
        movement += steps
        pos = end
        amount = min(missing, energy)
        transfers += 1
        energy -= amount
        missing -= amount
        if missing:
            targets[index] = targets[index][0], missing
        else:
            targets.pop(index)
    return {"modeledTicks": movement + transfers + withdrawals, "movementSteps": movement,
            "transfers": transfers, "withdrawals": withdrawals,
            "carryCapacity": carry_capacity, "buffer": "link" if link else "container",
            "linkAvailable": bool(requested_link), "bufferFirst": buffer_first}


def evaluate(plan):
    result = {}
    for level in (2, 3, 4, 5, 6, 7, 8):
        cases = [refill(plan, level, reverse=reverse, use_link=link)
                 for link in ((False, True) if level == 8 else (False,)) for reverse in (False, True)]
        result[str(level)] = {"minimumTicks": min(c["modeledTicks"] for c in cases),
                              "maximumTicks": max(c["modeledTicks"] for c in cases), "cases": cases}
    return result


def rank(plan, supply):
    """Joint objective; repeated haul distance is deliberately penalized.

    Optimize the worst refill case at RCL8 + 0.5*RCL8 container-only worst
    + 0.5*RCL6 + 0.25*RCL2;
    add 2*both mine->storage, both mine->spawn, 0.5*mine->controller,
    hub->controller, and a modest perimeter upkeep penalty.
    This selects the best searched proposal, not a proof of a global optimum.
    """
    paths = plan["metrics"]["sourceRoadSteps"]
    battery_worst = max(c["modeledTicks"] for c in supply["8"]["cases"] if c["buffer"] == "container")
    return round(supply["8"]["maximumTicks"] + .5 * battery_worst + .5 * supply["6"]["maximumTicks"]
                 + .25 * supply["2"]["maximumTicks"]
                 + sum(2 * row["storage"] + row["spawn"] + .5 * row["controllerSupply"] for row in paths.values())
                 + plan["metrics"]["roadStepsFromHub"]["controller"]
                 + .25 * plan["metrics"]["perimeterTiles"], 3)
