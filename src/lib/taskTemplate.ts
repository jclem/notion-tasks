import type {
	CreatePageParameters,
	PageObjectResponse,
	UpdatePageParameters,
} from "@notionhq/client";
import { Option } from "effect";
import { compileFriendlySchedule, type CompiledSchedule } from "./friendlySchedule.js";
import {
	checkboxProperty,
	datePropertyStart,
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
	rootTask: "Root Task",
	rrule: "RRULE",
	scheduleDescription: "Schedule Description",
	scheduleError: "Schedule Error",
} as const;

export const taskProperty = {
	title: "Title",
	status: "Status",
	due: "Due",
	completedAt: "Completed At",
	notes: "Notes",
	template: "Template",
	repeatOf: "Repeat Of",
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
	readonly schedule: string;
	readonly notes: string;
	readonly compiled: CompiledSchedule;
	readonly contextIds: ReadonlyArray<string>;
	readonly rootTaskId: Option.Option<string>;
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

	const schedule = richTextProperty(page, templateProperty.schedule);
	if (Option.isNone(schedule) || schedule.value.trim().length === 0) {
		return invalid(`${templateProperty.schedule} is required.`);
	}

	const compiled = compileFriendlySchedule(schedule.value);
	if (Option.isNone(compiled)) {
		return invalid(`Could not understand schedule: ${schedule.value}`);
	}

	return {
		ok: true,
		template: {
			page,
			name: name.value.trim(),
			enabled: enabled.value,
			mode: mode.value,
			starts: starts.value,
			schedule: schedule.value,
			notes: Option.getOrElse(richTextProperty(page, templateProperty.notes), () => ""),
			compiled: compiled.value,
			contextIds: Option.getOrElse(
				relationPropertyIds(page, templateProperty.context),
				() => [] as ReadonlyArray<string>,
			),
			rootTaskId: relationPropertyIds(page, templateProperty.rootTask).pipe(
				Option.flatMap((ids) => Option.fromNullishOr(ids[0])),
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
	rootTaskId: string,
	dueDate: string,
	occurrenceKey: string,
): NonNullable<CreatePageParameters["properties"]> {
	return {
		...synchronizedTaskProperties(template),
		[taskProperty.status]: { status: { name: "Not started" } },
		[taskProperty.due]: { date: { start: dueDate } },
		[taskProperty.completedAt]: { date: null },
		[taskProperty.repeatOf]: relationValue([rootTaskId]),
		[taskProperty.occurrenceKey]: richTextValue(occurrenceKey),
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
