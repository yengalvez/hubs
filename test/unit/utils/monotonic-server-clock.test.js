import test from "ava";

import { MonotonicServerClock } from "../../../src/utils/monotonic-server-clock";

test("initializes with the complete server epoch offset", t => {
  const clock = new MonotonicServerClock();

  t.is(clock.now(2000, 1_780_000_000_000), 1_780_000_000_000);
  t.is(clock.now(2100, 1_780_000_000_100), 1_780_000_000_100);
});

test("slews a forward server correction without fast-forwarding paths", t => {
  const clock = new MonotonicServerClock(50);

  const initial = clock.now(1000, 1_780_000_000_000);
  const corrected = clock.now(1100, 1_780_000_010_100);

  t.is(corrected - initial, 105);
});

test("never moves backwards when the server offset is corrected", t => {
  const clock = new MonotonicServerClock(50);

  const initial = clock.now(1000, 1_780_000_000_000);
  const corrected = clock.now(1100, 1_779_999_990_100);

  t.is(corrected - initial, 95);
  t.true(corrected >= initial);
});

test("keeps a monotonic local clock when a raw sample is unavailable", t => {
  const clock = new MonotonicServerClock();

  t.is(clock.now(1000, Number.NaN), 1000);
  t.is(clock.now(1100, Number.NaN), 1100);
});
