import { createRequire } from "node:module";
import type { Options } from "rrule";
import { Option } from "effect";

const require = createRequire(import.meta.url);
const { RRule } = require("rrule") as typeof import("rrule");

export type CompiledSchedule = {
	readonly rrule: string;
	readonly description: string;
};

/**
 * Compiles the small, intentionally predictable schedule language used by task
 * templates into an RFC 5545 RRULE without DTSTART.
 */
export function compileFriendlySchedule(value: string): Option.Option<CompiledSchedule> {
	const input = value.trim();
	if (input.length === 0) {
		return Option.none();
	}

	const normalized = normalizeFriendlyText(input);
	const options = parseRawOptions(input).pipe(
		Option.orElse(() => yearlyOrdinalOptions(normalized)),
		Option.orElse(() => monthlyOrdinalOptions(normalized)),
		Option.orElse(() => yearlyDateOptions(normalized)),
		Option.orElse(() => parseFriendlyOptions(normalized)),
		Option.filter((parsed) => parsed.freq !== undefined),
		Option.filter((parsed) => calendarFrequencies.has(parsed.freq as number)),
	);

	return options.pipe(
		Option.flatMap(makeRule),
		Option.map((rule) => ({
			rrule: rule.toString().replace(/^RRULE:/, ""),
			description: sentenceCase(rule.toText()),
		})),
	);
}

function yearlyDateOptions(value: string): Option.Option<Partial<Options>> {
	const match = value.match(
		/^(?:every year on )?(?:the )?(january|february|march|april|may|june|july|august|september|october|november|december) (\d{1,2})(?:st|nd|rd|th)?$/,
	);
	const reversedMatch = value.match(
		/^every (january|february|march|april|may|june|july|august|september|october|november|december) on the (\d{1,2})(?:st|nd|rd|th)?$/,
	);
	const parts = match ?? reversedMatch;
	if (!parts) {
		return Option.none();
	}

	const month = months.get(parts[1]);
	const monthDay = Number(parts[2]);
	return month && monthDay >= 1 && monthDay <= 31
		? Option.some({ freq: RRule.YEARLY, bymonth: month, bymonthday: monthDay })
		: Option.none();
}

function normalizeFriendlyText(value: string): string {
	const normalized = value.toLowerCase().replace(/[,.]$/g, "").replace(/\s+/g, " ").trim();

	return aliases.get(normalized) ?? normalized;
}

function yearlyOrdinalOptions(value: string): Option.Option<Partial<Options>> {
	const match = value.match(
		/^(?:(?:every year on )?the )?(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th) (monday|tuesday|wednesday|thursday|friday|saturday|sunday) (?:of|in) (january|february|march|april|may|june|july|august|september|october|november|december)$/,
	);
	if (!match) {
		return Option.none();
	}

	const ordinal = ordinals.get(match[1]);
	const weekday = weekdays.get(match[2]);
	const month = months.get(match[3]);
	return ordinal && weekday !== undefined && month
		? Option.some({ freq: RRule.YEARLY, bymonth: month, byweekday: [weekday.nth(ordinal)] })
		: Option.none();
}

function monthlyOrdinalOptions(value: string): Option.Option<Partial<Options>> {
	const match = value.match(
		/^(?:(?:every month on )?the )?(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th) (monday|tuesday|wednesday|thursday|friday|saturday|sunday) (?:of )?(?:every )?month$/,
	);
	if (!match) {
		return Option.none();
	}

	const ordinal = ordinals.get(match[1]);
	const weekday = weekdays.get(match[2]);
	return ordinal && weekday !== undefined
		? Option.some({ freq: RRule.MONTHLY, byweekday: [weekday.nth(ordinal)] })
		: Option.none();
}

const parseFriendlyOptions = (value: string): Option.Option<Partial<Options>> =>
	parseText(value.startsWith("every ") ? value : `every ${value}`).pipe(
		Option.map((rule) => rule.origOptions),
	);

const parseRawOptions = (value: string): Option.Option<Partial<Options>> =>
	value.includes("FREQ=") ? parseString(value.replace(/^RRULE:/i, "")) : Option.none();

function sentenceCase(value: string): string {
	return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

const aliases = new Map<string, string>([
	["daily", "every day"],
	["weekday", "every weekday"],
	["weekdays", "every weekday"],
	["weekly", "every week"],
	["monthly", "every month"],
	["yearly", "every year"],
	["annually", "every year"],
]);

const ordinals = new Map<string, number>([
	["first", 1],
	["1st", 1],
	["second", 2],
	["2nd", 2],
	["third", 3],
	["3rd", 3],
	["fourth", 4],
	["4th", 4],
	["fifth", 5],
	["5th", 5],
	["last", -1],
]);

const weekdays = new Map<string, (typeof RRule)["MO"]>([
	["monday", RRule.MO],
	["tuesday", RRule.TU],
	["wednesday", RRule.WE],
	["thursday", RRule.TH],
	["friday", RRule.FR],
	["saturday", RRule.SA],
	["sunday", RRule.SU],
]);

const months = new Map<string, number>([
	["january", 1],
	["february", 2],
	["march", 3],
	["april", 4],
	["may", 5],
	["june", 6],
	["july", 7],
	["august", 8],
	["september", 9],
	["october", 10],
	["november", 11],
	["december", 12],
]);

const calendarFrequencies = new Set([RRule.DAILY, RRule.WEEKLY, RRule.MONTHLY, RRule.YEARLY]);
const parseText = Option.liftThrowable((value: string) => RRule.fromText(value));
const parseString = Option.liftThrowable((value: string) => RRule.parseString(value));
const makeRule = Option.liftThrowable((options: Partial<Options>) => new RRule(options));
