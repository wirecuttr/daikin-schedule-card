# Daikin 7-Day Schedule Lovelace Card

A visual 7-day $\times$ 6-period schedule editor card for Daikin One+ communicating thermostats in Home Assistant.

Connects directly to the `daikinone.get_schedule` and `daikinone.set_schedule` service layer provided by [`ha-daikinone`](https://github.com/zlangbert/ha-daikinone).

---

## Features

- **7-Day Tabbed Navigation:** Inspect and edit each day of the week (`Mon`–`Sun`) independently.
- **24-Hour Visual Timeline:** Color-coded proportional timeline bar displaying active periods and setpoints across the day.
- **6-Period Schedule Editor:** Configure enable state, label, 15-minute start time increments (`00:00`–`23:45`), and dual heating/cooling setpoints per period.
- **"Copy Day To..." Modal:** Replicate a programmed day across weekdays, weekends, or custom day selections.
- **"Copy to Thermostat..." Modal:** Replicate the 7-day schedule to other communicating Daikin thermostats in your home with a single click (automatically hidden if only one thermostat is present).
- **Standalone Copy Card (`daikin-schedule-copy-card`):** A dedicated utility card for quickly copying schedules between thermostats.
- **Backend Automation Script:** Includes a Home Assistant script template ([`docs/copy_schedule_script.md`](./docs/copy_schedule_script.md)) for schedule replication via automations or dashboard buttons.
- **Deadband Enforcement:** Automatically maintains minimum deadband spacing between heating and cooling targets.
- **Atomic Batch Saving:** Dispatches only modified days in a single service call transaction.
- **Zero-Dependency Native Web Component:** Built using standard Web Components (Custom Elements v1 & Shadow DOM) with no external framework overhead.

---

## Prerequisites

- Home Assistant `2024.1.0` or newer.
- [`ha-daikinone`](https://github.com/zlangbert/ha-daikinone) custom component with `daikinone.get_schedule` and `daikinone.set_schedule` services.

---

## Installation

### Method 1: HACS (Recommended)

1. In Home Assistant, open **HACS** $\rightarrow$ **Frontend**.
2. Click the three dots in the top right $\rightarrow$ **Custom repositories**.
3. Add repository URL `https://github.com/wirecuttr/daikin-schedule-card` with Category **Plugin** (Dashboard).
4. Click **Download**.

### Method 2: Manual Installation

1. Download [`daikin-schedule-card.js`](./daikin-schedule-card.js) from the latest release.
2. Place the file in your Home Assistant configuration directory under `www/` (e.g. `/config/www/daikin-schedule-card.js`).
3. Add the resource in **Settings** $\rightarrow$ **Dashboards** $\rightarrow$ **Resources**:
   - **URL:** `/local/daikin-schedule-card.js`
   - **Resource Type:** `JavaScript Module`

---

## Dashboard Configuration

Add the card to any Lovelace dashboard view:

```yaml
type: custom:daikin-schedule-card
entity: climate.mainfloor_thermostat
title: Main Floor Schedule
```

### Configuration Options

| Option | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `entity` | string | **Yes** | — | Target climate entity ID (`climate.<thermostat>`). |
| `title` | string | No | Thermostat name | Header card title. |
| `domain` | string | No | `daikinone` | Integration domain providing schedule services. |

---

## Standalone Schedule Copy Card

This package also registers a companion card (`custom:daikin-schedule-copy-card`) to copy schedules between thermostats without opening the full editor:

```yaml
type: custom:daikin-schedule-copy-card
title: Copy Thermostat Schedule
```

---

## Automation Script

For automations, NFC tags, or one-tap dashboard buttons, see the companion script configuration in [`docs/copy_schedule_script.md`](./docs/copy_schedule_script.md).

---

## License

Apache 2.0 © Wirecuttr and Contributors
