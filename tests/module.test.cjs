const { test } = require("node:test");
const assert = require("node:assert/strict");
const { frontend, helper } = require("./support.cjs");

const logic = require("../schoolday-logic.js");
const data = require("../school-day.example.json");
test("rotation skips closures and weekends", () => {
  const l = logic.create(data);
  assert.equal(l.dayInfo("2030-01-09").schoolDay, false);
  assert.equal(l.dayInfo("2030-01-10").letter, "C");
  assert.equal(l.dayInfo("2030-01-12").reason, "weekend");
});
test("invalid dates, anchors and override letters are rejected", () => {
  assert.throws(() => logic.toTs("2030-02-30"));
  assert.throws(() => logic.create({ ...data, anchors: [] }));
  assert.throws(() =>
    logic
      .create({ ...data, overrides: { "2030-01-08": "Z" } })
      .dayInfo("2030-01-08"),
  );
});
test("standalone card renders activities and optional next-day panel", () => {
  const m = frontend({ debugDate: "2030-01-08" });
  m.start();
  m.socketNotificationReceived("SCHOOLDAY_DATA", { instanceId: "one", data });
  assert.match(m.getDom().textContent, /Library/);
  assert.match(m.getDom().textContent, /Bring a book/);
  m.config.showNext = false;
  assert.doesNotMatch(m.getDom().textContent, /NEXT/);
  m.suspend();
});
test("timezone changes day selection without depending on host clock", () => {
  const m = frontend({ timezone: "America/New_York" }, "2030-01-08T02:00:00Z");
  assert.equal(m.today(), "2030-01-07");
  assert.equal(m.isEvening(), true);
});
test("helper returns per-instance errors rather than broadcasting raw data", () => {
  const h = helper({ "school-day.json": data });
  h.socketNotificationReceived("SCHOOLDAY_LOAD", { instanceId: "one" });
  assert.equal(h.sent.p.instanceId, "one");
  assert.equal(h.sent.n, "SCHOOLDAY_DATA");
  h.socketNotificationReceived("SCHOOLDAY_LOAD", {
    instanceId: "two",
    dataFile: "bad.json",
  });
  assert.equal(h.sent.n, "SCHOOLDAY_ERROR");
});
