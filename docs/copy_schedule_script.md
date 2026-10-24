# Copy Thermostat Schedule Script

This Home Assistant script copies the complete 7-day schedule matrix from one Daikin One+ thermostat to another using the `daikinone.get_schedule` and `daikinone.set_schedule` service layer.

---

## Home Assistant Script Configuration

Add the following YAML to your `/config/scripts.yaml` (or via **Settings** $\rightarrow$ **Automations & Scenes** $\rightarrow$ **Scripts** $\rightarrow$ **Add Script**):

```yaml
copy_thermostat_schedule:
  alias: Copy Thermostat Schedule
  description: Copy the 7-day schedule from one Daikin thermostat to another
  icon: mdi:calendar-sync
  fields:
    source_thermostat:
      name: Source Thermostat
      description: The climate entity to copy the schedule from
      required: true
      example: climate.mainfloor_thermostat
      selector:
        entity:
          domain: climate
          integration: daikinone
    target_thermostat:
      name: Target Thermostat
      description: The climate entity to copy the schedule to
      required: true
      example: climate.upstairs_thermostat
      selector:
        entity:
          domain: climate
          integration: daikinone
    copy_schedule_enabled:
      name: Copy Schedule Enabled State
      description: Whether to also copy the schedule enabled state
      default: true
      selector:
        boolean: {}
  sequence:
    - action: daikinone.get_schedule
      data:
        entity_id: "{{ source_thermostat }}"
      response_variable: source_sched
    - if:
        - condition: template
          value_template: "{{ copy_schedule_enabled | default(true) }}"
      then:
        - action: daikinone.set_schedule
          data:
            entity_id: "{{ target_thermostat }}"
            days: "{{ source_sched.days }}"
            temperature_unit: "{{ source_sched.temperature_unit }}"
            schedule_enabled: "{{ source_sched.schedule_enabled }}"
      else:
        - action: daikinone.set_schedule
          data:
            entity_id: "{{ target_thermostat }}"
            days: "{{ source_sched.days }}"
            temperature_unit: "{{ source_sched.temperature_unit }}"
  mode: single
```

---

## How It Works

1. **`daikinone.get_schedule`:** Retrieves the full 7-day $\times$ 6-period schedule from `source_thermostat` from local coordinator cache.
2. **`daikinone.set_schedule`:** Atomically pushes the days payload to `target_thermostat` and updates the local cache optimistically.
3. **`copy_schedule_enabled`:** If set to `true` (default), copies the master thermostat schedule on/off switch setting. If `false`, updates the period timetable while preserving the target thermostat's existing on/off state.

---

## Usage Examples

### 1. Developer Tools Service Call
Navigate to **Developer Tools** $\rightarrow$ **Services (Actions)** and run:

```yaml
action: script.copy_thermostat_schedule
data:
  source_thermostat: climate.mainfloor_thermostat
  target_thermostat: climate.upstairs_thermostat
  copy_schedule_enabled: true
```

### 2. Dashboard Button Card
Add a button to any dashboard to quickly sync schedules with a single tap:

```yaml
type: button
name: Sync Upstairs Schedule from Main Floor
icon: mdi:calendar-sync
tap_action:
  action: call-service
  service: script.copy_thermostat_schedule
  service_data:
    source_thermostat: climate.mainfloor_thermostat
    target_thermostat: climate.upstairs_thermostat
    copy_schedule_enabled: true
```
