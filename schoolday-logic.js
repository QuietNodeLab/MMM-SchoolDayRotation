/* schoolday-logic.js
 *
 * Pure date logic for the rotating letter-day schedule (A, B, C ...). There is no MagicMirror
 * code in here, so the same file runs in the browser (global SchoolDayLogic) and in plain
 * Node (require), which is how it gets tested.
 *
 * How the letter is worked out:
 *   - Weekends and dates listed in "closed" are not school days and use up no letter.
 *   - An "anchor" says "this date is letter X". For any other date we count school days from
 *     the nearest earlier anchor (or back from the first anchor for earlier dates).
 *   - "overrides" change a single day's letter without shifting anything after it.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SchoolDayLogic = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEKDAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const pad = (n) => String(n).padStart(2, "0");

  // "2026-10-19" -> UTC-midnight timestamp, so time zones and daylight saving never interfere.
  function toTs(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd));
    if (!m) {
      throw new Error("Bad date '" + ymd + "' (use YYYY-MM-DD)");
    }
    const ts = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    if (new Date(ts).toISOString().slice(0, 10) !== String(ymd))
      throw Error("Not a real date: " + ymd);
    return ts;
  }

  function toYmd(ts) {
    const d = new Date(ts);
    return (
      d.getUTCFullYear() +
      "-" +
      pad(d.getUTCMonth() + 1) +
      "-" +
      pad(d.getUTCDate())
    );
  }

  // A normal Date (the screen's local clock) -> its local calendar day.
  function localYmd(date) {
    return (
      date.getFullYear() +
      "-" +
      pad(date.getMonth() + 1) +
      "-" +
      pad(date.getDate())
    );
  }

  function addDays(ymd, n) {
    return toYmd(toTs(ymd) + n * DAY_MS);
  }

  function weekdayName(ymd) {
    return WEEKDAYS[new Date(toTs(ymd)).getUTCDay()];
  }

  function create(data) {
    const letters =
      data.letters && data.letters.length
        ? data.letters.map((x) => String(x).toUpperCase())
        : ["A", "B", "C", "D", "E", "F"];
    const n = letters.length;
    const closed = data.closed || {};
    const early = data.earlyDismissal || {};
    const overrides = data.overrides || {};
    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

    const anchors = (data.anchors || [])
      .map((a) => {
        const idx = letters.indexOf(String(a.letter).toUpperCase());
        if (idx < 0) {
          throw new Error(
            "Anchor letter '" +
              a.letter +
              "' is not one of " +
              letters.join(","),
          );
        }
        return { ts: toTs(a.date), idx: idx };
      })
      .sort((a, b) => a.ts - b.ts);
    if (!anchors.length) {
      throw new Error(
        'school-day.json needs at least one anchor, e.g. { "date": "2026-10-19", "letter": "A" }',
      );
    }

    function isSchoolDay(ts) {
      const wd = new Date(ts).getUTCDay();
      return wd !== 0 && wd !== 6 && !has(closed, toYmd(ts));
    }

    // School days in [fromTs, untilTs)
    function countSchoolDays(fromTs, untilTs) {
      let c = 0;
      for (let t = fromTs; t < untilTs; t += DAY_MS) {
        if (isSchoolDay(t)) {
          c++;
        }
      }
      return c;
    }

    function letterIndex(ts) {
      let anchor = null;
      anchors.forEach((a) => {
        if (a.ts <= ts) {
          anchor = a;
        }
      });
      if (anchor) {
        return (anchor.idx + countSchoolDays(anchor.ts, ts)) % n;
      }
      const first = anchors[0];
      const back = countSchoolDays(ts, first.ts);
      return (((first.idx - back) % n) + n) % n;
    }

    function dayInfo(ymd) {
      const ts = toTs(ymd);
      const wd = new Date(ts).getUTCDay();
      const info = {
        date: ymd,
        weekdayName: WEEKDAYS[wd],
        schoolDay: false,
        letter: null,
        reason: null,
        closedLabel: null,
        earlyDismissal: has(early, ymd) ? early[ymd] : null,
        overridden: false,
      };
      if (wd === 0 || wd === 6) {
        info.reason = "weekend";
        return info;
      }
      if (has(closed, ymd)) {
        info.reason = "closed";
        info.closedLabel = closed[ymd] || "School closed";
        return info;
      }
      info.schoolDay = true;
      if (has(overrides, ymd) && overrides[ymd]) {
        info.letter = String(overrides[ymd]).toUpperCase();
        if (!letters.includes(info.letter))
          throw Error("Override letter is not configured");
        info.overridden = true;
      } else {
        info.letter = letters[letterIndex(ts)];
      }
      return info;
    }

    // The first school day after the given date.
    function nextSchoolDay(ymd) {
      let ts = toTs(ymd) + DAY_MS;
      for (let i = 0; i < 400; i++, ts += DAY_MS) {
        if (isSchoolDay(ts)) {
          return dayInfo(toYmd(ts));
        }
      }
      return null;
    }

    // The next `count` school days starting at fromYmd (handy for checking against the portal).
    function upcoming(fromYmd, count) {
      const out = [];
      let ts = toTs(fromYmd);
      for (let i = 0; i < 800 && out.length < count; i++, ts += DAY_MS) {
        if (isSchoolDay(ts)) {
          out.push(dayInfo(toYmd(ts)));
        }
      }
      return out;
    }

    function specialsFor(letter, team) {
      const t = (data.teams || {})[team] || {};
      return t[letter] || [];
    }

    function remindersFor(specials) {
      const r = data.reminders || {};
      const out = [];
      specials.forEach((s) => {
        if (r[s] && out.indexOf(r[s]) < 0) {
          out.push(r[s]);
        }
      });
      return out;
    }

    return {
      dayInfo,
      nextSchoolDay,
      upcoming,
      isSchoolDay: (ymd) => isSchoolDay(toTs(ymd)),
      specialsFor,
      remindersFor,
    };
  }

  return { create, localYmd, addDays, weekdayName, toYmd, toTs };
});
