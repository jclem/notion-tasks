import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Option } from "effect";
import { compileFriendlySchedule } from "../src/lib/friendlySchedule.js";

describe("compileFriendlySchedule", () => {
	const examples = [
		["Weekdays", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
		["Every 2 weeks", "INTERVAL=2;FREQ=WEEKLY"],
		["Every month on the 20th", "FREQ=MONTHLY;BYMONTHDAY=20"],
		["Last Friday of every month", "FREQ=MONTHLY;BYDAY=-1FR"],
		["February 6", "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=6"],
		["1st Saturday of February", "FREQ=YEARLY;BYMONTH=2;BYDAY=+1SA"],
	] as const;

	for (const [schedule, expected] of examples) {
		it(`compiles ${schedule}`, () => {
			const result = compileFriendlySchedule(schedule);
			assert(Option.isSome(result));
			assert.equal(result.value.rrule, expected);
		});
	}

	it("rejects unsupported text", () => {
		assert(Option.isNone(compileFriendlySchedule("whenever I feel like it")));
	});

	it("accepts a raw RRULE as an escape hatch", () => {
		const result = compileFriendlySchedule("FREQ=DAILY;INTERVAL=30");
		assert(Option.isSome(result));
		assert.equal(result.value.rrule, "FREQ=DAILY;INTERVAL=30");
	});
});
