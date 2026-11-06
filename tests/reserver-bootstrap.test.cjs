const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  ts = require("typescript");
function requested(owner, remaining) {
  const code = ts.transpileModule(
    fs.readFileSync("src/overlords/colonization/reserver.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2024,
        useDefineForClassFields: false,
        experimentalDecorators: true,
      },
    },
  ).outputText;
  const deps = {
    "../Overlord": { Overlord: class {} },
    "../../profiler/decorator": { profile: (x) => x },
    "../../intel/RoomIntel": {
      RoomIntel: { roomReservedBy: () => owner, roomReservationRemaining: () => remaining },
    },
    "../../~settings": { MY_USERNAME: "me" },
    "../../creepSetups/setups": { Setups: { infestors: { reserve: {} } } },
  };
  const out = {};
  new Function("exports", "require", code)(out, (n) => deps[n] || {});
  const o = Object.create(out.ReservingOverlord.prototype);
  o.pos = { roomName: "remote" };
  let n;
  o.wishlist = (amount) => (n = amount);
  o.init();
  return n;
}
test("unseen unreserved outpost gets its first reserver to restore vision", () =>
  assert.equal(requested(undefined, 0), 1));
test("unseen healthy own reservation does not trigger unnecessary replacement", () =>
  assert.equal(requested("me", 4000), 0));
test("expiring own and foreign reservations can be visited", () => {
  assert.equal(requested("me", 999), 1);
  assert.equal(requested("other", 4000), 1);
});
