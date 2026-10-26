/* MMM-SchoolDayRotation
 *
 * A small square showing the school letter day (A-F), the specials for the student's team,
 * and reminders (sneakers, library book). From 6 PM on it switches to the NEXT school day so
 * you can pack for tomorrow, and it warns when tomorrow is a closure. Early-dismissal days
 * get a red tag. All the data lives in config/school-day.json and is re-read every 10 minutes.
 */
Module.register("MMM-SchoolDayRotation", {
  defaults: {
    timezone: null,
    debugDate: null,
    dataFile: "school-day.json", // looked up in the MagicMirror config folder
    studentName: "Sample Student",
    team: null, // null = use "team" from the JSON file
    refreshInterval: 10 * 60 * 1000,
    showNext: true, // "Tomorrow: B Day · Art" line under the square (daytime only)
    eveningHour: 18, // 24-hour clock: from this hour on, show the next school day. null = never
  },

  getScripts() {
    return [this.file("date-utils.js"), this.file("schoolday-logic.js")];
  },

  getStyles() {
    return [this.file("MMM-SchoolDayRotation.css")];
  },

  schedule(fn, ms) {
    this.timers.push(setInterval(fn, ms));
  },
  suspend() {
    (this.timers || []).forEach(clearInterval);
    this.timers = [];
  },
  resume() {
    this.start();
  },

  start() {
    this.suspend();
    this.schoolData = null;
    this.errorText = null;
    this.lastRaw = null;
    this.renderedState = null;

    this.requestData();
    this.schedule(() => this.requestData(), this.config.refreshInterval);

    // Redraw at midnight and at the evening switch-over without waiting for a data refresh.
    this.schedule(() => {
      if (this.renderedState && this.renderedState !== this.stateKey()) {
        this.updateDom(0);
      }
    }, 30 * 1000);
  },

  isEvening() {
    const hour = this.config.eveningHour;
    return (
      typeof hour === "number" &&
      SchoolDates.parts(this.config.timezone, this.config.debugDate).hour >=
        hour
    );
  },

  // Changes at midnight and at the evening switch-over.
  stateKey() {
    return this.today() + (this.isEvening() ? "|evening" : "");
  },

  today() {
    return SchoolDates.parts(this.config.timezone, this.config.debugDate).ymd;
  },

  requestData() {
    this.sendSocketNotification("SCHOOLDAY_LOAD", {
      instanceId: this.identifier,
      dataFile: this.config.dataFile,
    });
  },

  socketNotificationReceived(notification, payload) {
    if (!payload || payload.instanceId !== this.identifier) return;
    payload = notification.endsWith("_ERROR") ? payload.error : payload.data;
    if (notification === "SCHOOLDAY_DATA") {
      const raw = JSON.stringify(payload);
      if (raw === this.lastRaw && !this.errorText) {
        return; // nothing changed, skip the redraw
      }
      this.lastRaw = raw;
      this.schoolData = payload;
      this.errorText = null;
      this.updateDom(0);
    } else if (notification === "SCHOOLDAY_ERROR") {
      this.errorText = payload;
      this.updateDom(0);
    }
  },

  el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) {
      node.className = cls;
    }
    if (text !== undefined && text !== null) {
      node.textContent = text;
    }
    return node;
  },

  // module SCHOOL CARDS V1: show today and next school day together.
  moduleActivityEmoji(text) {
    const s = String(text || "").toLowerCase();
    if (/gym|physical education|\bp\.?e\.?\b|fitness|sports/.test(s))
      return "👟";
    if (/computer|technology|coding|digital/.test(s)) return "💻";
    if (/music|chorus|band/.test(s)) return "🎵";
    if (/library|reading|book/.test(s)) return "📚";
    if (/art|drawing|painting/.test(s)) return "🎨";
    if (/science|stem|lab/.test(s)) return "🔬";
    if (/dance|movement/.test(s)) return "💃";
    if (/health/.test(s)) return "💚";
    return "📘";
  },

  moduleSchoolCard(logic, today, team, wrapper) {
    const next = logic.nextSchoolDay(today);
    const todayInfo = logic.dayInfo(today);
    const evening = this.isEvening();
    const card = this.el("div", "sd-card sd-v1-card");
    wrapper.appendChild(card);
    card.appendChild(
      this.el(
        "div",
        "sd-v1-heading",
        "📚 " + this.config.studentName + " · SCHOOL DAY",
      ),
    );
    const columns = this.el(
      "div",
      "sd-v1-columns" + (this.config.showNext ? "" : " sd-v1-single"),
    );
    card.appendChild(columns);
    const addDay = (info, label, isNext) => {
      const panel = this.el("div", "sd-v1-day" + (isNext ? " sd-v1-next" : ""));
      columns.appendChild(panel);
      panel.appendChild(this.el("div", "sd-v1-when", label));
      if (!info || !info.schoolDay) {
        panel.appendChild(
          this.el(
            "div",
            "sd-v1-closed",
            info && info.closedLabel ? info.closedLabel : "No school",
          ),
        );
        return;
      }
      const specials = logic.specialsFor(info.letter, team) || [];
      const letter = this.el("div", "sd-v1-letter");
      letter.appendChild(this.el("span", "sd-v1-letter-text", info.letter));
      if (specials.length)
        letter.appendChild(
          this.el("span", "sd-v1-emoji", this.moduleActivityEmoji(specials[0])),
        );
      panel.appendChild(letter);
      panel.appendChild(
        this.el(
          "div",
          "sd-v1-activity",
          specials.length ? specials.join(" · ") : "School day",
        ),
      );
      const reminders = logic.remindersFor(specials) || [];
      if (reminders.length)
        panel.appendChild(
          this.el("div", "sd-v1-reminder", reminders.join(" · ")),
        );
      if (info.earlyDismissal)
        panel.appendChild(
          this.el("div", "sd-v1-reminder", "⏰ " + info.earlyDismissal),
        );
      panel.appendChild(
        this.el(
          "div",
          "sd-v1-date",
          info.weekdayName + " · " + info.date.slice(5),
        ),
      );
    };
    // During evenings, the next school day is the primary panel; never relabel it as today.
    const nextLabel = next
      ? next.date === SchoolDayLogic.addDays(today, 1)
        ? "TOMORROW"
        : "NEXT · " + next.weekdayName.toUpperCase()
      : "NEXT SCHOOL DAY";
    addDay(todayInfo, "TODAY", false);
    if (this.config.showNext) addDay(next, nextLabel, true);
    if (evening) card.classList.add("sd-v1-evening");
    return wrapper;
  },

  getDom() {
    const wrapper = this.el("div", "schoolday");

    if (this.errorText) {
      wrapper.appendChild(
        this.el("div", "sd-msg", "School day: " + this.errorText),
      );
      return wrapper;
    }
    if (!this.schoolData) {
      wrapper.appendChild(this.el("div", "sd-msg", "Loading school day..."));
      return wrapper;
    }

    let logic;
    try {
      logic = SchoolDayLogic.create(this.schoolData);
    } catch (e) {
      wrapper.appendChild(
        this.el("div", "sd-msg", "School day data problem: " + e.message),
      );
      return wrapper;
    }

    let today;
    try {
      today = this.today();
    } catch (error) {
      wrapper.appendChild(this.el("div", "sd-msg", error.message));
      return wrapper;
    }
    const tomorrow = SchoolDayLogic.addDays(today, 1);
    const team =
      this.config.team ||
      this.schoolData.team ||
      Object.keys(this.schoolData.teams || {})[0] ||
      "";
    this.renderedState = this.stateKey();

    return this.moduleSchoolCard(logic, today, team, wrapper);
  },
});
