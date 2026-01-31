# oldpal Roadmap

## Planned Features

### 1. Scheduled Commands

**Priority:** High
**Status:** Planned

Ability to schedule commands to run at specific times, either fixed or dynamic.

#### Fixed Schedules
- Cron-like syntax for recurring tasks
- One-time scheduled execution
- Example: `/schedule "9:00am" /email check` - check emails every day at 9am

#### Dynamic Schedules
- AI-determined timing based on context
- Trigger-based scheduling (e.g., "when I get an email from X, notify me")
- Adaptive scheduling based on patterns

#### Implementation Ideas
```
/schedule <time|cron> <command>
/schedule list
/schedule cancel <id>
/schedule dynamic "<condition>" <command>
```

---

### 2. Agent Stamina System

**Priority:** Medium
**Status:** Planned

Implement a stamina/energy system to prevent agent burnout and encourage sustainable pacing.

#### Stamina
- Depletes when performing rapid successive actions
- Regenerates during idle periods
- High stamina = faster, more complex operations allowed
- Low stamina = agent slows down, takes breaks, suggests deferring tasks

#### Energy (Human-Correlated)
- Follows human circadian rhythm patterns
- Morning: Energy ramps up (6am-10am)
- Midday: Peak energy (10am-2pm)
- Afternoon: Gradual decline (2pm-6pm)
- Evening: Low energy, maintenance mode (6pm-10pm)
- Night: Minimal activity, background tasks only (10pm-6am)

#### Behavior Effects
| Stamina | Energy | Agent Behavior |
|---------|--------|----------------|
| High | High | Full speed, complex tasks, proactive suggestions |
| High | Low | Capable but conservative, fewer suggestions |
| Low | High | Slower pace, rest breaks between tasks |
| Low | Low | Minimal activity, defer non-urgent tasks |

#### Configuration
```json
{
  "stamina": {
    "max": 100,
    "regenRate": 5,  // per minute idle
    "costPerAction": 2,
    "rapidActionPenalty": 10  // extra cost for actions < 5s apart
  },
  "energy": {
    "timezone": "local",
    "peakHours": [10, 14],
    "lowHours": [22, 6],
    "weekendMultiplier": 0.7  // reduced activity on weekends
  }
}
```

---

### 3. Agent Heartbeat System

**Priority:** High
**Status:** Planned

A heartbeat mechanism to determine if the agent is "awake" and responsive.

#### Heartbeat States
- **Awake**: Agent is active, processing, responding
- **Idle**: Agent is available but not actively working
- **Resting**: Agent is in low-power mode (low stamina/energy)
- **Sleeping**: Agent is offline, only emergency triggers wake it

#### Implementation
- Background process sends periodic heartbeat
- Tracks last activity timestamp
- Auto-transitions between states based on activity and energy levels
- External systems can query agent state via heartbeat endpoint

#### Heartbeat Data
```json
{
  "state": "awake",
  "lastHeartbeat": "2025-01-31T18:45:00Z",
  "lastActivity": "2025-01-31T18:44:30Z",
  "stamina": 85,
  "energy": 72,
  "uptime": "4h 23m",
  "tasksCompleted": 47,
  "nextScheduledTask": "2025-01-31T19:00:00Z"
}
```

#### Wake Conditions
- User interaction
- Scheduled task due
- High-priority trigger event
- External API call with wake flag

#### Sleep Conditions
- Extended idle period (configurable, default 30min)
- Energy below threshold
- Explicit `/sleep` command
- System resource constraints

---

### 4. Future Considerations

- **Memory consolidation during sleep**: Agent reviews and summarizes learnings
- **Dream mode**: Background processing of deferred tasks during low-activity periods
- **Mood system**: Agent personality shifts based on stamina/energy (more creative when rested, more focused when tired)
- **Health metrics dashboard**: `/health` command showing stamina, energy, heartbeat, scheduled tasks

---

## Implementation Order

1. **Phase 1**: Heartbeat system (foundation for other features)
2. **Phase 2**: Energy system (time-based activity modulation)
3. **Phase 3**: Stamina system (activity-based pacing)
4. **Phase 4**: Scheduled commands (requires heartbeat for execution)
5. **Phase 5**: Integration and tuning

---

## Notes

- All systems should be optional and configurable
- Default behavior should feel natural, not gamified
- Focus on sustainable AI assistance, not constant availability
- Consider user preferences for agent activity patterns
