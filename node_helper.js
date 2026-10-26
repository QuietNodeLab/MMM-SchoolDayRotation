const NodeHelper = require("node_helper"),
  fs = require("node:fs"),
  path = require("node:path");
module.exports = NodeHelper.create({
  read(file) {
    const name = path.basename(String(file));
    const found = [
      path.join(global.root_path, "config", name),
      path.join(__dirname, name),
    ].find((p) => fs.existsSync(p));
    if (!found) throw Error("Missing " + name);
    return JSON.parse(fs.readFileSync(found, "utf8"));
  },
  socketNotificationReceived(notification, payload) {
    if (
      notification !== "SCHOOLDAY_LOAD" ||
      !payload ||
      typeof payload.instanceId !== "string"
    )
      return;
    try {
      const data = this.read(payload.dataFile || "school-day.json");
      this.sendSocketNotification("SCHOOLDAY_DATA", {
        instanceId: payload.instanceId,
        data,
      });
    } catch (error) {
      this.sendSocketNotification("SCHOOLDAY_ERROR", {
        instanceId: payload.instanceId,
        error: error.message,
      });
    }
  },
});
