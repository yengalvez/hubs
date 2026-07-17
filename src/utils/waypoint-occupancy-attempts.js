export class WaypointMoveIntentTracker {
  constructor() {
    this.sequence = 0;
    this.current = null;
  }

  begin() {
    const intent = Object.freeze({ sequence: ++this.sequence });
    this.current = intent;
    return intent;
  }

  isCurrent(intent) {
    return this.current === intent;
  }

  cancel(expectedIntent = null) {
    if (!expectedIntent || this.isCurrent(expectedIntent)) this.current = null;
  }
}

export class WaypointSpawnJobRunner {
  constructor() {
    this.jobs = [];
  }

  add(job) {
    this.jobs.push(job);
  }

  tick() {
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      if (this.jobs[i]().done) this.jobs.splice(i, 1);
    }
  }

  get size() {
    return this.jobs.length;
  }
}

export class WaypointOccupancyAttempts {
  constructor() {
    this.sequence = 0;
    this.current = null;
  }

  begin(waypoint) {
    const attempt = Object.freeze({ sequence: ++this.sequence, waypoint });
    this.current = attempt;
    return attempt;
  }

  isCurrent(attempt) {
    return this.current === attempt;
  }

  isPending(waypoint) {
    return !!this.current && this.current.waypoint === waypoint;
  }

  clear(attempt) {
    if (this.isCurrent(attempt)) this.current = null;
  }

  cancel() {
    this.current = null;
  }
}
