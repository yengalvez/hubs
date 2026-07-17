export function stableWaypointReservationId(components) {
  const waypointId = components && components.networked && components.networked.id;
  return typeof waypointId === "string" && waypointId.length > 0 ? waypointId : null;
}
