import type {
	CreatePageParameters,
	PageObjectResponse,
	UpdatePageParameters,
} from "@notionhq/client";
import { Option } from "effect";
import { calendarDateAfterDays } from "./dateUtils.js";
import { compileFriendlySchedule, type CompiledSchedule } from "./friendlySchedule.js";
import {
	checkboxProperty,
	datePropertyStart,
	numberProperty,
	relationPropertyIds,
	richTextProperty,
	selectPropertyName,
	titleProperty,
} from "./notionProperties.js";

export const templateProperty = {
	enabled: "Enabled",
	mode: "Repeat Mode",
	schedule: "Schedule",
	starts: "Starts",
	notes: "Notes",
	context: "Context",
	rrule: "RRULE",
	scheduleDescription: "Schedule Description",
	scheduleError: "Schedule Error",
	dueOffsetDays: "Due Offset Days",
} as const;

export const taskProperty = {
	title: "Title",
	status: "Status",
	due: "Due",
	start: "Start",
	completedAt: "Completed At",
	notes: "Notes",
	template: "Template",
	occurrenceKey: "Occurrence Key",
	context: "Context",
} as const;

export const repeatMode = {
	regularly: "Regularly",
	afterCompletion: "After completion",
} as const;

export type RepeatMode = (typeof repeatMode)[keyof typeof repeatMode];

export type TaskTemplate = {
	readonly page: PageObjectResponse;
	readonly name: string;
	readonly enabled: boolean;
	readonly mode: RepeatMode;
	readonly starts: string;
	readonly dueOffsetDays: number | null;
	readonly schedule: string;
	readonly notes: string;
	readonly compiled: CompiledSchedule;
	readonly contextIds: ReadonlyArray<string>;
};

export type TemplateParseResult =
	| { readonly ok: true; readonly template: TaskTemplate }
	| { readonly ok: false; readonly message: string };

/** Parses and validates a Task Templates page. */
export function parseTaskTemplate(page: PageObjectResponse): TemplateParseResult {
	const name = titleProperty(page);
	if (Option.isNone(name) || name.value.trim().length === 0) {
		return invalid("Template title is required.");
	}

	const enabled = checkboxProperty(page, templateProperty.enabled);
	if (Option.isNone(enabled)) {
		return invalid(`Missing checkbox property: ${templateProperty.enabled}.`);
	}

	const mode = selectPropertyName(page, templateProperty.mode);
	if (
		Option.isNone(mode) ||
		(mode.value !== repeatMode.regularly && mode.value !== repeatMode.afterCompletion)
	) {
		return invalid(
			`${templateProperty.mode} must be ${repeatMode.regularly} or ${repeatMode.afterCompletion}.`,
		);
	}

	const starts = datePropertyStart(page, templateProperty.starts);
	if (Option.isNone(starts)) {
		return invalid(`${templateProperty.starts} is required.`);
	}
	if (Option.isNone(calendarDateAfterDays(starts.value, 0))) {
		return invalid(`${templateProperty.starts} must be a date without a time.`);
	}

	const schedule = richTextProperty(page, templateProperty.schedule);
	if (Option.isNone(schedule) || schedule.value.trim().length === 0) {
		return invalid(`${templateProperty.schedule} is required.`);
	}

	const compiled = compileFriendlySchedule(schedule.value);
	if (Option.isNone(compiled)) {
		return invalid(`Could not understand schedule: ${schedule.value}`);
	}

	const dueOffsetDays = numberProperty(page, templateProperty.dueOffsetDays);
	if (
		Option.isSome(dueOffsetDays) &&
		(!Number.isInteger(dueOffsetDays.value) || dueOffsetDays.value < 0)
	) {
		return invalid(`${templateProperty.dueOffsetDays} must be a non-negative whole number.`);
	}
	return {
		ok: true,
		template: {
			page,
			name: name.value.trim(),
			enabled: enabled.value,
			mode: mode.value,
			starts: starts.value,
			dueOffsetDays: Option.getOrNull(dueOffsetDays),
			schedule: schedule.value,
			notes: Option.getOrElse(richTextProperty(page, templateProperty.notes), () => ""),
			compiled: compiled.value,
			contextIds: Option.getOrElse(
				relationPropertyIds(page, templateProperty.context),
				() => [] as ReadonlyArray<string>,
			),
		},
	};
}

/** Properties controlled by a template on every related task. */
export function synchronizedTaskProperties(
	template: TaskTemplate,
): NonNullable<UpdatePageParameters["properties"]> {
	return {
		[taskProperty.title]: titleValue(template.name),
		[taskProperty.notes]: richTextValue(template.notes),
		[taskProperty.context]: relationValue(template.contextIds),
		[taskProperty.template]: relationValue([template.page.id]),
	};
}

/** Properties for a newly materialized task instance. */
export function newTaskProperties(
	template: TaskTemplate,
	occurrenceDate: string,
	occurrenceKey: string,
): NonNullable<CreatePageParameters["properties"]> {
	return {
		...synchronizedTaskProperties(template),
		...scheduledTaskDateProperties(template, occurrenceDate),
		[taskProperty.status]: { status: { name: "Not started" } },
		[taskProperty.completedAt]: { date: null },
		[taskProperty.occurrenceKey]: richTextValue(occurrenceKey),
	};
}

export function scheduledTaskDates(
	template: Pick<TaskTemplate, "dueOffsetDays">,
	occurrenceDate: string,
): { readonly start: string; readonly due: string | null } {
	const due =
		template.dueOffsetDays === null
			? null
			: Option.getOrThrowWith(
					calendarDateAfterDays(occurrenceDate, template.dueOffsetDays),
					() => new InvalidOccurrenceDateError(occurrenceDate),
				);
	return { start: occurrenceDate, due };
}

export function scheduledTaskDateProperties(
	template: Pick<TaskTemplate, "dueOffsetDays">,
	occurrenceDate: string,
): NonNullable<CreatePageParameters["properties"]> {
	const dates = scheduledTaskDates(template, occurrenceDate);
	return {
		[taskProperty.start]: { date: { start: dates.start } },
		[taskProperty.due]: { date: dates.due === null ? null : { start: dates.due } },
	};
}

export function richTextValue(value: string) {
	return {
		rich_text: value.length === 0 ? [] : [{ type: "text" as const, text: { content: value } }],
	};
}

export function titleValue(value: string) {
	return { title: [{ type: "text" as const, text: { content: value } }] };
}

export function relationValue(ids: ReadonlyArray<string>) {
	return { relation: ids.map((id) => ({ id })) };
}

function invalid(message: string): TemplateParseResult {
	return { ok: false, message };
}

class InvalidOccurrenceDateError extends Error {
	constructor(value: string) {
		super(`Invalid occurrence date: ${value}`);
		this.name = "InvalidOccurrenceDateError";
	}
}
