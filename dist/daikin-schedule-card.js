/**
 * Daikin One+ 7-Day Visual Schedule Lovelace Card (Phase 3B)
 * Connects to daikinone.get_schedule and daikinone.set_schedule (Phase 3A).
 */

const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_BY_INDEX = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const DAY_LABELS = {
  mon: { short: "Mon", full: "Monday" },
  tue: { short: "Tue", full: "Tuesday" },
  wed: { short: "Wed", full: "Wednesday" },
  thu: { short: "Thu", full: "Thursday" },
  fri: { short: "Fri", full: "Friday" },
  sat: { short: "Sat", full: "Saturday" },
  sun: { short: "Sun", full: "Sunday" },
};

const PERIOD_COLORS = [
  "#f59e0b", // Part 1 (Wake - Amber)
  "#3b82f6", // Part 2 (Day/Away - Blue)
  "#10b981", // Part 3 (Afternoon/Home - Emerald)
  "#8b5cf6", // Part 4 (Dinner/Evening - Violet)
  "#6366f1", // Part 5 (Sleep - Indigo)
  "#334155", // Part 6 (Night - Slate)
];

function formatTimeParts(h24, min, locale) {
  const timeFormat = locale?.time_format;
  const lang = locale?.language || navigator.language || "en";

  let hour12 = undefined;
  if (timeFormat === "12") {
    hour12 = true;
  } else if (timeFormat === "24") {
    hour12 = false;
  }

  try {
    const d = new Date(2000, 0, 1, h24, min);
    return new Intl.DateTimeFormat(lang, {
      hour: "numeric",
      minute: "2-digit",
      ...(hour12 !== undefined ? { hour12 } : {}),
    }).format(d);
  } catch (e) {
    if (hour12 === false) {
      return `${String(h24).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
    const period = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(min).padStart(2, "0")} ${period}`;
  }
}

function formatTimeStr(timeStr, locale) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map((n) => parseInt(n, 10) || 0);
  return formatTimeParts(h, m, locale);
}

function getOrderedDays(firstDaySetting, language) {
  let startDay = "monday";
  if (firstDaySetting && firstDaySetting !== "language") {
    startDay = firstDaySetting.toLowerCase();
  } else {
    try {
      const weekInfo = new Intl.Locale(language || "en").getWeekInfo?.();
      if (weekInfo?.firstDay === 7) {
        startDay = "sunday";
      } else if (weekInfo?.firstDay === 6) {
        startDay = "saturday";
      } else {
        startDay = "monday";
      }
    } catch (e) {
      startDay = "monday";
    }
  }

  const dayMap = {
    monday: "mon",
    tuesday: "tue",
    wednesday: "wed",
    thursday: "thu",
    friday: "fri",
    saturday: "sat",
    sunday: "sun",
  };
  const startKey = dayMap[startDay] || "mon";
  const startIndex = ALL_DAYS.indexOf(startKey);
  if (startIndex <= 0) return [...ALL_DAYS];
  return [...ALL_DAYS.slice(startIndex), ...ALL_DAYS.slice(0, startIndex)];
}

function timeStrToSlot(timeStr) {
  const [h, m] = (timeStr || "00:00").split(":").map((n) => parseInt(n, 10) || 0);
  return Math.max(0, Math.min(95, Math.floor((h * 60 + m) / 15)));
}

class DaikinScheduleCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._domain = "daikinone";
    this._originalSchedule = null;
    this._workingSchedule = null;
    this._selectedDay = this._getCurrentDayKey();
    this._dirtyDays = new Set();
    this._scheduleEnabledDirty = false;
    this._loading = false;
    this._saving = false;
    this._error = null;
    this._statusMessage = null;
    this._copyModalOpen = false;
    this._copyTargets = new Set();
    this._copyThermostatModalOpen = false;
    this._copyThermostatTargets = new Set();
    this._copyThermostatEnabledState = true;
    this._copyingThermostat = false;
    this._initialized = false;
  }

  _getCurrentDayKey() {
    return DAY_BY_INDEX[new Date().getDay()];
  }

  _getDayKeys() {
    return getOrderedDays(this._hass?.locale?.first_day_of_week, this._hass?.locale?.language);
  }

  _getTimeOptions() {
    const options = [];
    for (let slot = 0; slot < 96; slot++) {
      const totalMinutes = slot * 15;
      const h24 = Math.floor(totalMinutes / 60);
      const min = totalMinutes % 60;
      const value = `${String(h24).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      const label = formatTimeParts(h24, min, this._hass?.locale);
      options.push({ slot, value, label });
    }
    return options;
  }

  _formatTimeStr(timeStr) {
    return formatTimeStr(timeStr, this._hass?.locale);
  }

  setConfig(config) {
    if (!config.entity || !config.entity.startsWith("climate.")) {
      throw new Error("Please specify a valid Daikin climate entity (e.g. climate.mainfloor_thermostat).");
    }
    this._config = config;
    this._domain = config.domain || "daikinone";
    this._initialized = false;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized && this._config && this._hass) {
      this._initialized = true;
      this._fetchSchedule();
    }
  }

  getCardSize() {
    return 7;
  }

  async _fetchSchedule() {
    if (!this._hass || !this._config) return;
    this._loading = true;
    this._error = null;
    this._statusMessage = null;
    this._render();

    try {
      const res = await this._hass.callWS({
        type: "call_service",
        domain: this._domain,
        service: "get_schedule",
        service_data: {
          entity_id: this._config.entity,
        },
        return_response: true,
      });

      const data = res.response;
      this._originalSchedule = JSON.parse(JSON.stringify(data));
      this._workingSchedule = JSON.parse(JSON.stringify(data));
      this._dirtyDays.clear();
      this._scheduleEnabledDirty = false;
    } catch (err) {
      this._error = err?.message || "Failed to load thermostat schedule.";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  async _saveSchedule() {
    if (!this._hass || !this._workingSchedule || this._saving) return;
    if (this._dirtyDays.size === 0 && !this._scheduleEnabledDirty) return;

    this._saving = true;
    this._error = null;
    this._statusMessage = null;
    this._render();

    try {
      const daysPayload = {};
      for (const dayKey of this._dirtyDays) {
        daysPayload[dayKey] = this._workingSchedule.days[dayKey].map((p) => ({
          part: p.part,
          enabled: Boolean(p.enabled),
          start_time: p.start_time,
          heat_target: Number(p.heat_target),
          cool_target: Number(p.cool_target),
          label: String(p.label || "").trim(),
        }));
      }

      const serviceData = {
        entity_id: this._config.entity,
        temperature_unit: this._workingSchedule.temperature_unit,
      };
      if (Object.keys(daysPayload).length > 0) {
        serviceData.days = daysPayload;
      }
      if (this._scheduleEnabledDirty) {
        serviceData.schedule_enabled = Boolean(this._workingSchedule.schedule_enabled);
      }

      await this._hass.callService(this._domain, "set_schedule", serviceData);

      const savedCount = this._dirtyDays.size;
      await this._fetchSchedule();
      this._statusMessage =
        savedCount > 0
          ? `Saved schedule changes across ${savedCount} day${savedCount > 1 ? "s" : ""}.`
          : "Updated schedule status.";
    } catch (err) {
      this._error = err?.message || "Failed to save schedule changes.";
    } finally {
      this._saving = false;
      this._render();
    }
  }

  _discardChanges() {
    if (!this._originalSchedule) return;
    this._workingSchedule = JSON.parse(JSON.stringify(this._originalSchedule));
    this._dirtyDays.clear();
    this._scheduleEnabledDirty = false;
    this._error = null;
    this._statusMessage = null;
    this._render();
  }

  _toggleMasterScheduleEnabled() {
    if (!this._workingSchedule) return;
    this._workingSchedule.schedule_enabled = !this._workingSchedule.schedule_enabled;
    this._scheduleEnabledDirty =
      this._workingSchedule.schedule_enabled !== this._originalSchedule.schedule_enabled;
    this._render();
  }

  _updatePeriodField(dayKey, partIndex, field, value) {
    const period = this._workingSchedule.days[dayKey][partIndex];
    if (!period) return;

    const minTemp = this._workingSchedule.min_temp ?? 10.0;
    const maxTemp = this._workingSchedule.max_temp ?? 32.0;
    const minDelta = this._workingSchedule.min_temp_delta ?? 2.0;

    if (field === "enabled") {
      period.enabled = Boolean(value);
    } else if (field === "label") {
      period.label = String(value).slice(0, 16);
    } else if (field === "start_time") {
      period.start_time = value;
      period.start_slot = timeStrToSlot(value);
    } else if (field === "heat_target") {
      let newHeat = Math.max(minTemp, Math.min(maxTemp - minDelta, Number(value.toFixed(1))));
      period.heat_target = newHeat;
      if (period.cool_target - newHeat < minDelta) {
        period.cool_target = Number(Math.min(maxTemp, newHeat + minDelta).toFixed(1));
      }
    } else if (field === "cool_target") {
      let newCool = Math.max(minTemp + minDelta, Math.min(maxTemp, Number(value.toFixed(1))));
      period.cool_target = newCool;
      if (newCool - period.heat_target < minDelta) {
        period.heat_target = Number(Math.max(minTemp, newCool - minDelta).toFixed(1));
      }
    }

    this._dirtyDays.add(dayKey);
    this._statusMessage = null;
    this._render();
  }

  _openCopyModal() {
    this._copyTargets = new Set();
    this._copyModalOpen = true;
    this._render();
  }

  _closeCopyModal() {
    this._copyModalOpen = false;
    this._copyTargets.clear();
    this._render();
  }

  _selectCopyPreset(preset) {
    this._copyTargets.clear();
    if (preset === "weekdays") {
      ["mon", "tue", "wed", "thu", "fri"].forEach((d) => {
        if (d !== this._selectedDay) this._copyTargets.add(d);
      });
    } else if (preset === "weekend") {
      ["sat", "sun"].forEach((d) => {
        if (d !== this._selectedDay) this._copyTargets.add(d);
      });
    } else if (preset === "all") {
      this._getDayKeys().forEach((d) => {
        if (d !== this._selectedDay) this._copyTargets.add(d);
      });
    }
    this._render();
  }

  _toggleCopyTarget(dayKey) {
    if (dayKey === this._selectedDay) return;
    if (this._copyTargets.has(dayKey)) {
      this._copyTargets.delete(dayKey);
    } else {
      this._copyTargets.add(dayKey);
    }
    this._render();
  }

  _applyCopyDay() {
    if (!this._workingSchedule || this._copyTargets.size === 0) return;
    const sourcePeriods = this._workingSchedule.days[this._selectedDay];
    for (const targetDay of this._copyTargets) {
      this._workingSchedule.days[targetDay] = JSON.parse(JSON.stringify(sourcePeriods));
      this._dirtyDays.add(targetDay);
    }
    const count = this._copyTargets.size;
    const sourceName = DAY_LABELS[this._selectedDay].full;
    this._copyModalOpen = false;
    this._copyTargets.clear();
    this._statusMessage = `Copied ${sourceName} schedule to ${count} day${count > 1 ? "s" : ""}. Click Save schedule to apply.`;
    this._render();
  }

  _getAvailableThermostats() {
    if (!this._hass?.states) return [];
    const currentEntity = this._config?.entity;
    return Object.keys(this._hass.states)
      .filter((eid) => {
        if (!eid.startsWith("climate.") || eid === currentEntity) return false;
        const state = this._hass.states[eid];
        return (
          state?.attributes?.schedule_enabled !== undefined ||
          this._hass.entities?.[eid]?.platform === this._domain
        );
      })
      .map((eid) => ({
        entity_id: eid,
        name: this._hass.states[eid].attributes.friendly_name || eid,
      }));
  }

  _openCopyThermostatModal() {
    this._copyThermostatModalOpen = true;
    this._copyThermostatTargets = new Set();
    const available = this._getAvailableThermostats();
    if (available.length > 0) {
      this._copyThermostatTargets.add(available[0].entity_id);
    }
    this._copyThermostatEnabledState = true;
    this._render();
  }

  _closeCopyThermostatModal() {
    this._copyThermostatModalOpen = false;
    this._copyThermostatTargets.clear();
    this._render();
  }

  _toggleCopyThermostatTarget(entityId) {
    if (this._copyThermostatTargets.has(entityId)) {
      this._copyThermostatTargets.delete(entityId);
    } else {
      this._copyThermostatTargets.add(entityId);
    }
    this._render();
  }

  async _applyCopyThermostat() {
    if (!this._hass || !this._workingSchedule || this._copyThermostatTargets.size === 0 || this._copyingThermostat) return;
    this._copyingThermostat = true;
    this._error = null;
    this._statusMessage = null;
    this._render();

    try {
      const daysPayload = {};
      for (const dayKey of ALL_DAYS) {
        if (this._workingSchedule.days[dayKey]) {
          daysPayload[dayKey] = this._workingSchedule.days[dayKey].map((p) => ({
            part: p.part,
            enabled: Boolean(p.enabled),
            start_time: p.start_time,
            heat_target: Number(p.heat_target),
            cool_target: Number(p.cool_target),
            label: String(p.label || "").trim(),
          }));
        }
      }

      const targetList = Array.from(this._copyThermostatTargets);
      for (const targetEntity of targetList) {
        const payload = {
          entity_id: targetEntity,
          temperature_unit: this._workingSchedule.temperature_unit,
          days: daysPayload,
        };
        if (this._copyThermostatEnabledState) {
          payload.schedule_enabled = Boolean(this._workingSchedule.schedule_enabled);
        }
        await this._hass.callService(this._domain, "set_schedule", payload);
      }

      this._copyThermostatModalOpen = false;
      this._copyThermostatTargets.clear();
      const targetNames = targetList
        .map((eid) => this._hass.states[eid]?.attributes?.friendly_name || eid)
        .join(", ");
      this._statusMessage = `Successfully copied schedule to ${targetNames}.`;
    } catch (err) {
      this._error = err?.message || "Failed to copy schedule to other thermostats.";
    } finally {
      this._copyingThermostat = false;
      this._render();
    }
  }

  _buildTimelineSegments(dayKey) {
    const periods = (this._workingSchedule?.days?.[dayKey] || [])
      .map((p, idx) => ({ ...p, color: PERIOD_COLORS[idx % PERIOD_COLORS.length] }))
      .filter((p) => p.enabled)
      .sort((a, b) => a.start_slot - b.start_slot);

    if (periods.length === 0) {
      return [
        {
          widthPct: 100,
          color: "#475569",
          label: "No active periods enabled for this day",
          sublabel: "",
        },
      ];
    }

    const segments = [];
    const unit = this._workingSchedule.temperature_unit || "°C";

    if (periods[0].start_slot > 0) {
      const carry = periods[periods.length - 1];
      segments.push({
        widthPct: (periods[0].start_slot / 96) * 100,
        color: "#334155",
        label: this._formatTimeStr("00:00"),
        sublabel: `${carry.heat_target}${unit} / ${carry.cool_target}${unit}`,
      });
    }

    for (let i = 0; i < periods.length; i++) {
      const current = periods[i];
      const nextSlot = i + 1 < periods.length ? periods[i + 1].start_slot : 96;
      const span = Math.max(1, nextSlot - current.start_slot);
      const timeStr = this._formatTimeStr(current.start_time);
      const label = current.label ? `${current.label} ${timeStr}` : timeStr;
      segments.push({
        widthPct: (span / 96) * 100,
        color: current.color,
        label,
        sublabel: `${current.heat_target}${unit} / ${current.cool_target}${unit}`,
      });
    }

    return segments;
  }

  _render() {
    if (!this.shadowRoot) return;

    const rawTitle =
      this._config?.title ||
      (this._workingSchedule?.name ? `${this._workingSchedule.name} schedule` : "Thermostat schedule");
    const title = rawTitle.replace(/\b7-Day\s*/i, "").trim();
    const unit = this._workingSchedule?.temperature_unit || "°C";
    const step = unit === "°F" ? 1.0 : 0.5;
    const hasUnsaved = this._dirtyDays.size > 0 || this._scheduleEnabledDirty;

    const dayPeriods = this._workingSchedule?.days?.[this._selectedDay] || [];
    const timelineSegments = this._workingSchedule ? this._buildTimelineSegments(this._selectedDay) : [];
    const timeOptions = this._getTimeOptions();

    let badgeText = "Schedule disabled";
    let badgeClass = "badge-disabled";
    if (this._workingSchedule?.schedule_enabled) {
      if (this._workingSchedule?.schedule_override) {
        badgeText = "Temporary hold";
        badgeClass = "badge-hold";
      } else {
        badgeText = "Following schedule";
        badgeClass = "badge-active";
      }
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
          color: var(--primary-text-color, #e2e8f0);
        }
        ha-card {
          container-type: inline-size;
          container-name: card;
          padding: 16px;
          background: var(--ha-card-background, var(--card-background-color, #1e293b));
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, none);
          position: relative;
          box-sizing: border-box;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 14px;
        }
        .title-block h2 {
          margin: 0;
          font-family: var(--ha-card-header-font-family, inherit);
          font-size: var(--ha-card-header-font-size, 1.2rem);
          font-weight: var(--ha-card-header-font-weight, 600);
          color: var(--ha-card-header-color, var(--primary-text-color));
        }
        .header-controls {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .badge {
          font-size: 0.75rem;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 999px;
        }
        .badge-active {
          background: rgba(16, 185, 129, 0.18);
          color: #34d399;
        }
        .badge-hold {
          background: rgba(245, 158, 11, 0.2);
          color: #fbbf24;
        }
        .badge-disabled {
          background: rgba(148, 163, 184, 0.18);
          color: #94a3b8;
        }
        .icon-btn {
          background: var(--secondary-background-color, rgba(148, 163, 184, 0.16));
          border: 1px solid var(--divider-color, transparent);
          color: var(--primary-text-color, #e2e8f0);
          border-radius: 8px;
          padding: 6px 10px;
          cursor: pointer;
          font-size: 0.82rem;
        }
        .icon-btn:hover {
          background: rgba(148, 163, 184, 0.25);
        }
        .day-tabs {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 6px;
          margin-bottom: 14px;
        }
        .day-tab {
          background: var(--secondary-background-color, rgba(148, 163, 184, 0.12));
          border: 1px solid var(--divider-color, transparent);
          border-radius: 8px;
          padding: 8px 4px;
          text-align: center;
          font-size: 0.84rem;
          font-weight: 600;
          color: var(--secondary-text-color, #94a3b8);
          cursor: pointer;
          position: relative;
        }
        .day-tab.active {
          background: var(--primary-color, #03a9f4);
          color: #ffffff;
        }
        .day-tab .dirty-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #f59e0b;
          margin-left: 3px;
          vertical-align: middle;
        }
        .timeline-container {
          margin-bottom: 16px;
          background: var(--secondary-background-color, rgba(148, 163, 184, 0.1));
          border: 1px solid var(--divider-color, rgba(148, 163, 184, 0.15));
          padding: 10px;
          border-radius: 10px;
        }
        .timeline-bar {
          display: flex;
          width: 100%;
          height: 36px;
          border-radius: 6px;
          overflow: hidden;
          margin-bottom: 6px;
        }
        .timeline-seg {
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 0 6px;
          color: #ffffff;
          font-size: 0.7rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          border-right: 1px solid rgba(255, 255, 255, 0.18);
        }
        .timeline-scale {
          display: flex;
          justify-content: space-between;
          font-size: 0.7rem;
          color: var(--secondary-text-color, #94a3b8);
        }
        .periods-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 16px;
        }
        .period-row {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--card-background-color, rgba(148, 163, 184, 0.08));
          border: 1px solid var(--divider-color, rgba(148, 163, 184, 0.15));
          box-sizing: border-box;
        }
        .period-row.disabled {
          opacity: 0.48;
        }
        .period-header {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          box-sizing: border-box;
        }
        .period-enable {
          width: 18px;
          height: 18px;
          cursor: pointer;
          accent-color: var(--primary-color, #03a9f4);
          flex-shrink: 0;
          margin: 0;
        }
        .period-label {
          flex: 1 1 auto;
          min-width: 60px;
        }
        .period-time {
          flex: 0 0 auto;
          width: 115px;
        }
        .period-steppers {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          padding-left: 26px;
          box-sizing: border-box;
        }
        .label-input, .time-select {
          background: var(--input-fill-color, var(--secondary-background-color, rgba(148, 163, 184, 0.12)));
          border: 1px solid var(--input-idle-line-color, var(--divider-color, rgba(148, 163, 184, 0.3)));
          border-radius: 6px;
          color: var(--primary-text-color, inherit);
          font-family: inherit;
          font-size: 0.95rem;
          font-weight: 500;
          padding: 6px 8px;
          box-sizing: border-box;
        }
        .time-select option {
          background: var(--card-background-color, #ffffff);
          color: var(--primary-text-color, #212121);
        }
        .stepper-box {
          display: inline-flex;
          align-items: center;
          background: var(--input-fill-color, var(--secondary-background-color, rgba(148, 163, 184, 0.12)));
          border: 1px solid var(--divider-color, rgba(148, 163, 184, 0.25));
          border-radius: 8px;
          padding: 3px 6px;
          box-sizing: border-box;
          gap: 4px;
        }
        .stepper-icon {
          --mdc-icon-size: 18px;
          width: 18px;
          height: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .stepper-icon.heat {
          color: #fb923c;
        }
        .stepper-icon.cool {
          color: #38bdf8;
        }
        .stepper-controls {
          display: flex;
          align-items: center;
          gap: 3px;
        }
        @container card (min-width: 600px) {
          .period-row {
            flex-direction: row;
            align-items: center;
            gap: 10px;
          }
          .period-header {
            flex: 1 1 auto;
          }
          .period-steppers {
            flex: 0 0 auto;
            padding-left: 0;
          }
        }
        .step-btn {
          width: 24px;
          height: 24px;
          border-radius: 6px;
          border: 1px solid var(--divider-color, rgba(148, 163, 184, 0.35));
          background: var(--card-background-color, rgba(148, 163, 184, 0.15));
          color: var(--primary-text-color, inherit);
          font-weight: 700;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .step-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
        .step-val {
          min-width: 44px;
          text-align: center;
          font-size: 0.95rem;
          font-weight: 600;
        }
        .footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          padding-top: 8px;
          border-top: 1px solid var(--divider-color, rgba(148, 163, 184, 0.15));
        }
        .footer-right {
          display: flex;
          gap: 8px;
        }
        .btn {
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 0.84rem;
          font-weight: 600;
          border: none;
          cursor: pointer;
        }
        .btn-secondary {
          background: var(--secondary-background-color, rgba(148, 163, 184, 0.18));
          border: 1px solid var(--divider-color, rgba(148, 163, 184, 0.3));
          color: var(--primary-text-color, inherit);
        }
        .btn-primary {
          background: var(--primary-color, #03a9f4);
          color: #ffffff;
        }
        .btn-primary:disabled, .btn-secondary:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .banner {
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 0.82rem;
          margin-bottom: 12px;
        }
        .banner-error {
          background: rgba(239, 68, 68, 0.2);
          color: #fca5a5;
        }
        .banner-status {
          background: rgba(16, 185, 129, 0.2);
          color: #6ee7b7;
        }
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .modal {
          background: var(--ha-card-background, var(--card-background-color, #1e293b));
          border: 1px solid var(--divider-color, rgba(148, 163, 184, 0.25));
          border-radius: 12px;
          padding: 18px;
          width: 90%;
          max-width: 400px;
        }
        .modal h3 {
          margin: 0 0 10px 0;
          font-size: 1rem;
        }
        .preset-pills {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-bottom: 12px;
        }
        .copy-days-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
          margin-bottom: 16px;
        }
        .footer-left {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .copy-thermostats-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 180px;
          overflow-y: auto;
          margin-bottom: 8px;
        }
        .thermostat-cb-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.88rem;
          cursor: pointer;
        }
        .thermostat-cb-label input {
          width: 18px;
          height: 18px;
          accent-color: var(--primary-color, #03a9f4);
          cursor: pointer;
        }
      </style>
      <ha-card>
        <div class="header">
          <div class="title-block">
            <h2>${title}</h2>
          </div>
          <div class="header-controls">
            <span class="badge ${badgeClass}">${badgeText}</span>
            <button class="icon-btn" id="toggle-sched-btn" title="Toggle schedule enabled">
              ${this._workingSchedule?.schedule_enabled ? "Disable schedule" : "Enable schedule"}
            </button>
            <button class="icon-btn" id="refresh-btn" title="Reload schedule from memory">↻</button>
          </div>
        </div>

        ${this._error ? `<div class="banner banner-error">${this._error}</div>` : ""}
        ${this._statusMessage ? `<div class="banner banner-status">${this._statusMessage}</div>` : ""}

        ${
          this._loading
            ? `<div style="padding: 24px; text-align: center;">Loading schedule...</div>`
            : this._workingSchedule
              ? `
          <div class="day-tabs">
            ${this._getDayKeys().map(
              (d) => `
              <button class="day-tab ${d === this._selectedDay ? "active" : ""}" data-day="${d}">
                ${DAY_LABELS[d].short}
                ${this._dirtyDays.has(d) ? `<span class="dirty-dot" title="Unsaved changes"></span>` : ""}
              </button>
            `
            ).join("")}
          </div>

          <div class="timeline-container">
            <div class="timeline-bar">
              ${timelineSegments
                .map(
                  (seg) => `
                <div class="timeline-seg" style="width: ${seg.widthPct}%; background: ${seg.color};" title="${seg.label} ${seg.sublabel}">
                  <strong>${seg.label}</strong>
                  <span>${seg.sublabel}</span>
                </div>
              `
                )
                .join("")}
            </div>
            <div class="timeline-scale">
              <span>${this._formatTimeStr("00:00")}</span>
              <span>${this._formatTimeStr("06:00")}</span>
              <span>${this._formatTimeStr("12:00")}</span>
              <span>${this._formatTimeStr("18:00")}</span>
              <span>${this._formatTimeStr("24:00")}</span>
            </div>
          </div>

          <div class="periods-list">
            ${dayPeriods
              .map(
                (p, idx) => `
              <div class="period-row ${p.enabled ? "" : "disabled"}">
                <div class="period-header">
                  <input
                    type="checkbox"
                    class="period-enable"
                    data-idx="${idx}"
                    ${p.enabled ? "checked" : ""}
                    title="Enable period"
                  />

                  <input
                    type="text"
                    class="label-input period-label"
                    data-idx="${idx}"
                    value="${p.label || ""}"
                    placeholder=""
                    ${p.enabled ? "" : "disabled"}
                  />

                  <select class="time-select period-time" data-idx="${idx}" ${p.enabled ? "" : "disabled"}>
                    ${timeOptions.map(
                      (opt) => `
                      <option value="${opt.value}" ${opt.value === p.start_time ? "selected" : ""}>
                        ${opt.label}
                      </option>
                    `
                    ).join("")}
                  </select>
                </div>

                <div class="period-steppers">
                  <div class="stepper-box">
                    <ha-icon icon="mdi:snowflake" class="stepper-icon cool" title="Cool"></ha-icon>
                    <div class="stepper-controls">
                      <button class="step-btn cool-dec" data-idx="${idx}" ${p.enabled ? "" : "disabled"}>-</button>
                      <span class="step-val">${Number(p.heat_target).toFixed(1)}${unit}</span>
                      <button class="step-btn cool-inc" data-idx="${idx}" ${p.enabled ? "" : "disabled"}>+</button>
                    </div>
                  </div>

                  <div class="stepper-box">
                    <ha-icon icon="mdi:fire" class="stepper-icon heat" title="Heat"></ha-icon>
                    <div class="stepper-controls">
                      <button class="step-btn heat-dec" data-idx="${idx}" ${p.enabled ? "" : "disabled"}>-</button>
                      <span class="step-val">${Number(p.cool_target).toFixed(1)}${unit}</span>
                      <button class="step-btn heat-inc" data-idx="${idx}" ${p.enabled ? "" : "disabled"}>+</button>
                    </div>
                  </div>
                </div>
              </div>
            `
              )
              .join("")}
          </div>

          <div class="footer">
            <div class="footer-left">
              <button class="btn btn-secondary" id="open-copy-btn">
                Copy ${DAY_LABELS[this._selectedDay].full} to...
              </button>
              ${
                this._getAvailableThermostats().length > 0
                  ? `<button class="btn btn-secondary" id="open-copy-thermostat-btn">
                      Copy to thermostat...
                    </button>`
                  : ""
              }
            </div>
            <div class="footer-right">
              <button class="btn btn-secondary" id="discard-btn" ${!hasUnsaved || this._saving ? "disabled" : ""}>
                Discard
              </button>
              <button class="btn btn-primary" id="save-btn" ${!hasUnsaved || this._saving ? "disabled" : ""}>
                ${
                  this._saving
                    ? "Saving..."
                    : this._dirtyDays.size > 0
                      ? `Save schedule (${this._dirtyDays.size} day${this._dirtyDays.size > 1 ? "s" : ""})`
                      : "Save schedule"
                }
              </button>
            </div>
          </div>
        `
              : ""
        }

        ${
          this._copyModalOpen
            ? `
          <div class="modal-backdrop">
            <div class="modal">
              <h3>Copy ${DAY_LABELS[this._selectedDay].full} schedule to:</h3>
              <div class="preset-pills">
                <button class="icon-btn copy-preset" data-preset="weekdays">Weekdays (Mon–Fri)</button>
                <button class="icon-btn copy-preset" data-preset="weekend">Weekend (Sat–Sun)</button>
                <button class="icon-btn copy-preset" data-preset="all">All days</button>
                <button class="icon-btn copy-preset" data-preset="clear">Clear</button>
              </div>
              <div class="copy-days-grid">
                ${this._getDayKeys().map(
                  (d) => `
                  <label>
                    <input
                      type="checkbox"
                      class="copy-target-cb"
                      data-day="${d}"
                      ${d === this._selectedDay ? "checked disabled" : this._copyTargets.has(d) ? "checked" : ""}
                    />
                    ${DAY_LABELS[d].full} ${d === this._selectedDay ? "(Source)" : ""}
                  </label>
                `
                ).join("")}
              </div>
              <div class="footer-right" style="justify-content: flex-end;">
                <button class="btn btn-secondary" id="close-copy-btn">Cancel</button>
                <button class="btn btn-primary" id="apply-copy-btn" ${this._copyTargets.size === 0 ? "disabled" : ""}>
                  Copy to ${this._copyTargets.size} day${this._copyTargets.size === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          </div>
        `
            : ""
        }

        ${
          this._copyThermostatModalOpen
            ? `
          <div class="modal-backdrop">
            <div class="modal">
              <h3>Copy Schedule to Thermostat</h3>
              <p style="font-size: 0.84rem; color: var(--secondary-text-color); margin: 0 0 12px 0;">
                Copy 7-day schedule from <strong>${this._workingSchedule?.name || title}</strong> to:
              </p>
              <div class="copy-thermostats-list">
                ${
                  this._getAvailableThermostats().length === 0
                    ? `<div style="font-size: 0.85rem; color: var(--secondary-text-color);">No other thermostats found.</div>`
                    : this._getAvailableThermostats()
                        .map(
                          (t) => `
                    <label class="thermostat-cb-label">
                      <input
                        type="checkbox"
                        class="copy-target-thermostat-cb"
                        data-entity="${t.entity_id}"
                        ${this._copyThermostatTargets.has(t.entity_id) ? "checked" : ""}
                      />
                      <span>${t.name}</span>
                    </label>
                  `
                        )
                        .join("")
                }
              </div>
              <div style="margin-top: 12px; margin-bottom: 16px;">
                <label class="thermostat-cb-label">
                  <input
                    type="checkbox"
                    id="copy-thermostat-enabled-cb"
                    ${this._copyThermostatEnabledState ? "checked" : ""}
                  />
                  <span>Also copy schedule enabled status</span>
                </label>
              </div>
              <div class="footer-right" style="justify-content: flex-end;">
                <button class="btn btn-secondary" id="close-copy-thermostat-btn">Cancel</button>
                <button
                  class="btn btn-primary"
                  id="apply-copy-thermostat-btn"
                  ${this._copyThermostatTargets.size === 0 || this._copyingThermostat ? "disabled" : ""}
                >
                  ${this._copyingThermostat ? "Copying..." : "Copy Schedule"}
                </button>
              </div>
            </div>
          </div>
        `
            : ""
        }
      </ha-card>
    `;

    this._bindEvents(step);
  }

  _bindEvents(step) {
    const root = this.shadowRoot;
    if (!root) return;

    root.getElementById("refresh-btn")?.addEventListener("click", () => this._fetchSchedule());
    root.getElementById("toggle-sched-btn")?.addEventListener("click", () => this._toggleMasterScheduleEnabled());
    root.getElementById("discard-btn")?.addEventListener("click", () => this._discardChanges());
    root.getElementById("save-btn")?.addEventListener("click", () => this._saveSchedule());
    root.getElementById("open-copy-btn")?.addEventListener("click", () => this._openCopyModal());
    root.getElementById("close-copy-btn")?.addEventListener("click", () => this._closeCopyModal());
    root.getElementById("apply-copy-btn")?.addEventListener("click", () => this._applyCopyDay());

    root.querySelectorAll(".day-tab").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        this._selectedDay = e.currentTarget.dataset.day;
        this._render();
      });
    });

    root.querySelectorAll(".period-enable").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        this._updatePeriodField(this._selectedDay, idx, "enabled", e.currentTarget.checked);
      });
    });

    root.querySelectorAll(".period-label").forEach((input) => {
      input.addEventListener("change", (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        this._updatePeriodField(this._selectedDay, idx, "label", e.currentTarget.value);
      });
    });

    root.querySelectorAll(".period-time").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        this._updatePeriodField(this._selectedDay, idx, "start_time", e.currentTarget.value);
      });
    });

    root.querySelectorAll(".cool-dec").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        const cur = this._workingSchedule.days[this._selectedDay][idx].heat_target;
        this._updatePeriodField(this._selectedDay, idx, "heat_target", cur - step);
      });
    });

    root.querySelectorAll(".cool-inc").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        const cur = this._workingSchedule.days[this._selectedDay][idx].heat_target;
        this._updatePeriodField(this._selectedDay, idx, "heat_target", cur + step);
      });
    });

    root.querySelectorAll(".heat-dec").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        const cur = this._workingSchedule.days[this._selectedDay][idx].cool_target;
        this._updatePeriodField(this._selectedDay, idx, "cool_target", cur - step);
      });
    });

    root.querySelectorAll(".heat-inc").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        const cur = this._workingSchedule.days[this._selectedDay][idx].cool_target;
        this._updatePeriodField(this._selectedDay, idx, "cool_target", cur + step);
      });
    });

    root.querySelectorAll(".copy-preset").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        this._selectCopyPreset(e.currentTarget.dataset.preset);
      });
    });

    root.querySelectorAll(".copy-target-cb").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        this._toggleCopyTarget(e.currentTarget.dataset.day);
      });
    });

    root.getElementById("open-copy-thermostat-btn")?.addEventListener("click", () => this._openCopyThermostatModal());
    root.getElementById("close-copy-thermostat-btn")?.addEventListener("click", () => this._closeCopyThermostatModal());
    root.getElementById("apply-copy-thermostat-btn")?.addEventListener("click", () => this._applyCopyThermostat());
    root.getElementById("copy-thermostat-enabled-cb")?.addEventListener("change", (e) => {
      this._copyThermostatEnabledState = e.currentTarget.checked;
    });
    root.querySelectorAll(".copy-target-thermostat-cb").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        this._toggleCopyThermostatTarget(e.currentTarget.dataset.entity);
      });
    });
  }
}

class DaikinScheduleCopyCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._sourceEntity = null;
    this._targetEntity = null;
    this._copyEnabled = true;
    this._copying = false;
    this._error = null;
    this._statusMessage = null;
    this._initialized = false;
  }

  setConfig(config) {
    this._config = config || {};
    this._sourceEntity = this._config.source_entity || null;
    this._targetEntity = this._config.target_entity || null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized && hass) {
      this._initialized = true;
      const clim = this._getClimateEntities();
      if (!this._sourceEntity && clim.length > 0) {
        this._sourceEntity = clim[0].entity_id;
      }
      if (!this._targetEntity && clim.length > 1) {
        this._targetEntity = clim[1].entity_id;
      }
    }
    this._render();
  }

  getCardSize() {
    return 3;
  }

  _getClimateEntities() {
    if (!this._hass?.states) return [];
    return Object.keys(this._hass.states)
      .filter((eid) => {
        if (!eid.startsWith("climate.")) return false;
        const state = this._hass.states[eid];
        return (
          state?.attributes?.schedule_enabled !== undefined ||
          this._hass.entities?.[eid]?.platform === "daikinone"
        );
      })
      .map((eid) => ({
        entity_id: eid,
        name: this._hass.states[eid].attributes.friendly_name || eid,
      }));
  }

  async _copySchedule() {
    if (!this._hass || !this._sourceEntity || !this._targetEntity || this._copying) return;
    if (this._sourceEntity === this._targetEntity) {
      this._error = "Source and target thermostats must be different.";
      this._render();
      return;
    }

    this._copying = true;
    this._error = null;
    this._statusMessage = null;
    this._render();

    try {
      const res = await this._hass.callWS({
        type: "call_service",
        domain: "daikinone",
        service: "get_schedule",
        service_data: {
          entity_id: this._sourceEntity,
        },
        return_response: true,
      });

      const sourceSched = res.response;
      if (!sourceSched || !sourceSched.days) {
        throw new Error("Source thermostat did not return schedule data.");
      }

      const daysPayload = {};
      for (const dayKey of Object.keys(sourceSched.days)) {
        daysPayload[dayKey] = sourceSched.days[dayKey].map((p) => ({
          part: p.part,
          enabled: Boolean(p.enabled),
          start_time: p.start_time,
          heat_target: Number(p.heat_target),
          cool_target: Number(p.cool_target),
          label: String(p.label || "").trim(),
        }));
      }

      const payload = {
        entity_id: this._targetEntity,
        temperature_unit: sourceSched.temperature_unit,
        days: daysPayload,
      };
      if (this._copyEnabled) {
        payload.schedule_enabled = Boolean(sourceSched.schedule_enabled);
      }

      await this._hass.callService("daikinone", "set_schedule", payload);

      const srcName = this._hass.states[this._sourceEntity]?.attributes?.friendly_name || this._sourceEntity;
      const tgtName = this._hass.states[this._targetEntity]?.attributes?.friendly_name || this._targetEntity;
      this._statusMessage = `Successfully copied schedule from ${srcName} to ${tgtName}.`;
    } catch (err) {
      this._error = err?.message || "Failed to copy schedule.";
    } finally {
      this._copying = false;
      this._render();
    }
  }

  _render() {
    if (!this.shadowRoot) return;
    const title = this._config?.title || "Copy Thermostat Schedule";
    const clim = this._getClimateEntities();

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
          color: var(--primary-text-color, #e2e8f0);
        }
        ha-card {
          padding: 16px;
          background: var(--ha-card-background, var(--card-background-color, #1e293b));
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, none);
          box-sizing: border-box;
        }
        .header h2 {
          margin: 0 0 14px 0;
          font-family: var(--ha-card-header-font-family, inherit);
          font-size: var(--ha-card-header-font-size, 1.2rem);
          font-weight: var(--ha-card-header-font-weight, 600);
          color: var(--ha-card-header-color, var(--primary-text-color));
        }
        .form-grid {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .field-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .field-group label {
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--secondary-text-color, #94a3b8);
        }
        .entity-select {
          background: var(--input-fill-color, var(--secondary-background-color, rgba(148, 163, 184, 0.12)));
          border: 1px solid var(--input-idle-line-color, var(--divider-color, rgba(148, 163, 184, 0.3)));
          border-radius: 6px;
          color: var(--primary-text-color, inherit);
          font-family: inherit;
          font-size: 0.95rem;
          padding: 8px 10px;
          box-sizing: border-box;
          width: 100%;
        }
        .entity-select option {
          background: var(--card-background-color, #ffffff);
          color: var(--primary-text-color, #212121);
        }
        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.88rem;
          cursor: pointer;
          margin-top: 2px;
        }
        .checkbox-label input {
          width: 18px;
          height: 18px;
          accent-color: var(--primary-color, #03a9f4);
          cursor: pointer;
        }
        .copy-btn {
          margin-top: 6px;
          padding: 10px 16px;
          border-radius: 8px;
          font-size: 0.9rem;
          font-weight: 600;
          border: none;
          background: var(--primary-color, #03a9f4);
          color: #ffffff;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .copy-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .banner {
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 0.82rem;
          margin-top: 10px;
        }
        .banner-error {
          background: rgba(239, 68, 68, 0.2);
          color: #fca5a5;
        }
        .banner-status {
          background: rgba(16, 185, 129, 0.2);
          color: #6ee7b7;
        }
      </style>
      <ha-card>
        <div class="header">
          <h2>${title}</h2>
        </div>
        <div class="form-grid">
          <div class="field-group">
            <label>Source Thermostat (copy from)</label>
            <select class="entity-select" id="source-select">
              ${clim
                .map(
                  (c) =>
                    `<option value="${c.entity_id}" ${c.entity_id === this._sourceEntity ? "selected" : ""}>${c.name} (${c.entity_id})</option>`
                )
                .join("")}
            </select>
          </div>

          <div class="field-group">
            <label>Target Thermostat (copy to)</label>
            <select class="entity-select" id="target-select">
              ${clim
                .map(
                  (c) =>
                    `<option value="${c.entity_id}" ${c.entity_id === this._targetEntity ? "selected" : ""}>${c.name} (${c.entity_id})</option>`
                )
                .join("")}
            </select>
          </div>

          <label class="checkbox-label">
            <input type="checkbox" id="copy-enabled-cb" ${this._copyEnabled ? "checked" : ""} />
            <span>Also copy schedule enabled status</span>
          </label>

          <button class="copy-btn" id="run-copy-btn" ${this._copying || clim.length < 2 ? "disabled" : ""}>
            ${this._copying ? "Copying Schedule..." : "Copy Schedule"}
          </button>

          ${this._error ? `<div class="banner banner-error">${this._error}</div>` : ""}
          ${this._statusMessage ? `<div class="banner banner-status">${this._statusMessage}</div>` : ""}
        </div>
      </ha-card>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    const root = this.shadowRoot;
    if (!root) return;

    root.getElementById("source-select")?.addEventListener("change", (e) => {
      this._sourceEntity = e.currentTarget.value;
      this._error = null;
      this._statusMessage = null;
    });

    root.getElementById("target-select")?.addEventListener("change", (e) => {
      this._targetEntity = e.currentTarget.value;
      this._error = null;
      this._statusMessage = null;
    });

    root.getElementById("copy-enabled-cb")?.addEventListener("change", (e) => {
      this._copyEnabled = e.currentTarget.checked;
    });

    root.getElementById("run-copy-btn")?.addEventListener("click", () => {
      this._copySchedule();
    });
  }
}

if (!customElements.get("daikin-schedule-card")) {
  customElements.define("daikin-schedule-card", DaikinScheduleCard);
}

if (!customElements.get("daikin-schedule-copy-card")) {
  customElements.define("daikin-schedule-copy-card", DaikinScheduleCopyCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "daikin-schedule-card",
  name: "Daikin schedule card",
  description: "Visual schedule editor for Daikin One+ thermostats.",
});
window.customCards.push({
  type: "daikin-schedule-copy-card",
  name: "Daikin schedule copy card",
  description: "Copy schedule between Daikin One+ thermostats.",
});
