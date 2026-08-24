import { createRequire } from "node:module";
import type { Options } from "rrule";
import { Array, DateTime, HashSet, Option, pipe } from "effect";

const require = createRequire(import.meta.url);
const { RRule } = require("rrule") as typeof import("rrule");

/**
 * Calculates the next date-only occurrence from an iCalendar recurrence rule,
 * using the Eastern calendar date that contains the completion timestamp as DTSTART.
 *
 * @param timestamp - The ISO 8601 completion timestamp.
 * @param recurrenceRule - An RFC 5545 RRULE, such as `FREQ=DAILY;INTERVAL=30`.
 * @returns The next ISO 8601 occurrence date (`YYYY-MM-DD`) without a time, or
 * `Option.none()` when the rule is invalid or has no subsequent occurrence.
 */
export function occurrenceDateFromCompletion(
	timestamp: string,
	recurrenceRule: string,
): Option.Option<string> {
	return Option.gen(function* () {
		const start = yield* easternMidnightUtc(timestamp);
		const rule = yield* parseRecurrenceRule(recurrenceRule, start);
		const due = yield* recurrenceAfter(rule, DateTime.toDateUtc(start));
		return yield* DateTime.make(due).pipe(Option.map(DateTime.formatIsoDateUtc));
	});
}

/**
 * Lists calendar-date recurrence occurrences that fall on or after the current
 * Eastern day and no later than six calendar months after it.
 *
 * @param recurrenceRule - An RFC 5545 RRULE with a daily-or-longer frequency.
 * @param occurrenceDate - The template's first scheduled date, which supplies DTSTART.
 * @param now - The ISO 8601 timestamp used to establish the Eastern-day cutoff.
 * @returns Future ISO 8601 calendar dates, or `Option.none()` when the inputs are invalid.
 */
export function futureOccurrenceDates(
	recurrenceRule: string,
	occurrenceDate: string,
	now: string,
): Option.Option<string[]> {
	return Option.gen(function* () {
		const start = yield* calendarMidnightUtc(occurrenceDate);
		const cutoff = yield* easternMidnightUtc(now);
		const rule = yield* parseRecurrenceRule(recurrenceRule, start).pipe(
			Option.filter((rule) => HashSet.has(calendarFrequencies, rule.options.freq)),
		);

		const windowEnd = DateTime.add(cutoff, { months: 6 });
		const occurrences = yield* recurrencesBetween(
			rule,
			DateTime.toDateUtc(cutoff),
			DateTime.toDateUtc(windowEnd),
		);
		return yield* pipe(
			occurrences,
			Array.filter((occurrence) => occurrence.getTime() >= DateTime.toEpochMillis(cutoff)),
			Array.map(DateTime.make),
			Option.all,
			Option.map(Array.map(DateTime.formatIsoDateUtc)),
		);
	});
}

/** Adds a non-negative number of calendar days to a date-only value. */
export function calendarDateAfterDays(value: string, days: number): Option.Option<string> {
	return DateTime.make(value).pipe(
		Option.filter((date) => DateTime.formatIsoDateUtc(date) === value),
		Option.map((date) => DateTime.add(date, { days })),
		Option.map(DateTime.formatIsoDateUtc),
	);
}

/**
 * Converts an ISO 8601 timestamp to the calendar date in Eastern Time.
 *
 * @param timestamp - The timestamp to convert.
 * @returns An ISO 8601 calendar date (`YYYY-MM-DD`) without a time, or
 * `Option.none()` when the timestamp is invalid.
 */
export function easternDate(timestamp: string): Option.Option<string> {
	return DateTime.makeZoned(timestamp, { timeZone: easternTimeZone }).pipe(
		Option.map(DateTime.formatIsoDate),
	);
}

function easternMidnightUtc(timestamp: string): Option.Option<DateTime.Utc> {
	return easternDate(timestamp).pipe(Option.flatMap(DateTime.make));
}

function calendarMidnightUtc(value: string): Option.Option<DateTime.Utc> {
	if (!calendarDatePattern.test(value)) {
		return easternMidnightUtc(value);
	}

	return DateTime.make(value).pipe(
		Option.filter((date) => DateTime.formatIsoDateUtc(date) === value),
	);
}

function parseRecurrenceRule(
	value: string,
	dtstart: DateTime.Utc,
): Option.Option<InstanceType<typeof RRule>> {
	return parseRecurrenceOptions(value.trim()).pipe(
		Option.filter((options) => options.freq !== undefined),
		Option.flatMap((options) => makeRecurrenceRule(options, DateTime.toDateUtc(dtstart))),
	);
}

function recurrenceAfter(rule: InstanceType<typeof RRule>, after: Date): Option.Option<Date> {
	return runRecurrenceAfter(rule, after).pipe(Option.flatMap(Option.fromNullishOr));
}

function recurrencesBetween(
	rule: InstanceType<typeof RRule>,
	after: Date,
	before: Date,
): Option.Option<Date[]> {
	return runRecurrencesBetween(rule, after, before);
}

const easternTimeZone = "America/New_York";
const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const calendarFrequencies: HashSet.HashSet<number> = HashSet.make(
	RRule.DAILY,
	RRule.WEEKLY,
	RRule.MONTHLY,
	RRule.YEARLY,
);
const parseRecurrenceOptions = Option.liftThrowable((value: string) => RRule.parseString(value));
const makeRecurrenceRule = Option.liftThrowable(
	(options: Partial<Options>, dtstart: Date) => new RRule({ ...options, dtstart }),
);
const runRecurrenceAfter = Option.liftThrowable((rule: InstanceType<typeof RRule>, after: Date) =>
	rule.after(after),
);
const runRecurrencesBetween = Option.liftThrowable(
	(rule: InstanceType<typeof RRule>, after: Date, before: Date) =>
		rule.between(after, before, true),
);
