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
