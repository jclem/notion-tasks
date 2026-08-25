import type { CreatePageParameters, PageObjectResponse } from "@notionhq/client";
import { Data, Effect, Option } from "effect";
import { easternDate, futureOccurrenceDates } from "./dateUtils.js";
import { NotionEffect } from "./notionEffect.js";
import {
	datePropertyStart,
	relationPropertyIds,
	richTextProperty,
	titleProperty,
} from "./notionProperties.js";
import { recurrencePlan } from "./recurrencePlan.js";
import {
	newTaskProperties,
	repeatMode,
	richTextValue,
	scheduledTaskDateProperties,
	scheduledTaskDates,
	synchronizedTaskProperties,
	taskProperty,
	templateProperty,
	type TaskTemplate,
	type TemplateParseResult,
} from "./taskTemplate.js";

/** Updates the compiled schedule diagnostics stored on a template when needed. */
export const updateTemplateDiagnostics = Effect.fn(function* (
	page: PageObjectResponse,
	parsed: TemplateParseResult,
) {
	const notion = yield* NotionEffect;
	const expected = parsed.ok
		? {
				rrule: parsed.template.compiled.rrule,
				description: parsed.template.compiled.description,
				error: "",
			}
		: { rrule: "", description: "", error: parsed.message };
	const current = {
		rrule: Option.getOrElse(richTextProperty(page, templateProperty.rrule), () => ""),
		description: Option.getOrElse(
			richTextProperty(page, templateProperty.scheduleDescription),
			() => "",
		),
		error: Option.getOrElse(richTextProperty(page, templateProperty.scheduleError), () => ""),
	};

	if (
		current.rrule === expected.rrule &&
		current.description === expected.description &&
		current.error === expected.error
	) {
		return;
	}

	yield* notion.pages.update({
		page_id: page.id,
		properties: {
			[templateProperty.rrule]: richTextValue(expected.rrule),
			[templateProperty.scheduleDescription]: richTextValue(expected.description),
			[templateProperty.scheduleError]: richTextValue(expected.error),
		},
	});
});

/**
 * Applies template-owned fields to all instances, copies template content into
 * new tasks, and reconciles a regular template's six-month materialization window.
 */
export const reconcileTemplate = Effect.fn(function* (
	template: TaskTemplate,
	tasksDataSourceId: string,
	now: string,
) {
	const notion = yield* NotionEffect;
	const instances = yield* queryTemplateInstances(tasksDataSourceId, template.page.id);

	if (!template.enabled) {
		yield* synchronizeInstances(template, instances);
		return;
	}

	const templateMarkdown = yield* notion.pages.retrieveMarkdown({ page_id: template.page.id });
	yield* synchronizeInstances(template, instances);

	if (template.mode === repeatMode.afterCompletion) {
		yield* ensureAfterCompletionInitialTask(
			template,
			tasksDataSourceId,
			instances,
			templateMarkdown,
		);
		return;
	}

	const schedule = Option.all({
		cutoff: easternDate(now),
		occurrenceDates: futureOccurrenceDates(template.compiled.rrule, template.starts, now),
	});
	if (Option.isNone(schedule)) {
		return yield* Effect.fail(
			new InvalidTemplateScheduleError({ templateId: template.page.id }),
		);
	}

	const plan = recurrencePlan(
		instances,
		schedule.value.occurrenceDates,
		schedule.value.cutoff,
		taskProperty.start,
		taskProperty.due,
	);
	for (const { occurrence, occurrenceDate } of plan.synchronize) {
		const properties = regularOccurrenceUpdateProperties(template, occurrenceDate);
		if (taskNeedsUpdate(occurrence, template, occurrenceDate)) {
			yield* notion.pages.update({
				page_id: occurrence.id,
				properties,
			});
		}
	}

	for (const { occurrence, occurrenceDate } of plan.reschedule) {
		yield* notion.pages.update({
			page_id: occurrence.id,
			properties: regularOccurrenceUpdateProperties(template, occurrenceDate),
		});
	}

	for (const occurrence of plan.archive) {
		yield* notion.pages.update({ page_id: occurrence.id, in_trash: true });
	}

	for (const occurrenceDate of plan.create) {
		yield* notion.pages.create({
			parent: { data_source_id: tasksDataSourceId },
			properties: regularOccurrenceCreateProperties(template, occurrenceDate),
			markdown: templateMarkdown,
		});
	}
});

export function queryTemplateInstances(tasksDataSourceId: string, templateId: string) {
	return Effect.gen(function* () {
		const notion = yield* NotionEffect;
		return yield* notion.dataSources.queryPages({
			data_source_id: tasksDataSourceId,
			filter: { property: taskProperty.template, relation: { contains: templateId } },
			sorts: [{ timestamp: "created_time", direction: "ascending" }],
		});
	});
}

function ensureAfterCompletionInitialTask(
	template: TaskTemplate,
	tasksDataSourceId: string,
	instances: ReadonlyArray<PageObjectResponse>,
	templateMarkdown: string,
) {
	return Effect.gen(function* () {
		const notion = yield* NotionEffect;
		const plan = afterCompletionInitialPlan(instances, template.page.id);
		for (const duplicateId of plan.duplicateIds) {
			yield* notion.pages.update({ page_id: duplicateId, in_trash: true });
		}

		if (!plan.create) {
			return;
		}

		yield* notion.pages.create({
			parent: { data_source_id: tasksDataSourceId },
			properties: newTaskProperties(template, template.starts, plan.occurrenceKey),
			markdown: templateMarkdown,
		});
	});
}

export function afterCompletionInitialPlan(
	instances: ReadonlyArray<PageObjectResponse>,
	templateId: string,
) {
	const occurrenceKey = `initial:${templateId}`;
	const initialInstances = instances.filter(
		(page) =>
			Option.getOrElse(richTextProperty(page, taskProperty.occurrenceKey), () => "") ===
			occurrenceKey,
	);
	return {
		occurrenceKey,
		create: instances.length === 0,
		duplicateIds: initialInstances.slice(1).map(({ id }) => id),
	} as const;
}

function synchronizeInstances(
	template: TaskTemplate,
	instances: ReadonlyArray<PageObjectResponse>,
) {
	return Effect.gen(function* () {
		const notion = yield* NotionEffect;
		for (const instance of instances) {
			if (taskNeedsTemplateSync(instance, template)) {
				yield* notion.pages.update({
					page_id: instance.id,
					properties: synchronizedTaskProperties(template),
				});
			}
		}
	});
}

function regularOccurrenceCreateProperties(
	template: TaskTemplate,
	occurrenceDate: string,
): NonNullable<CreatePageParameters["properties"]> {
	return newTaskProperties(
		template,
		occurrenceDate,
		`regular:${template.page.id}:${occurrenceDate}`,
	);
}

function regularOccurrenceUpdateProperties(
	template: TaskTemplate,
	occurrenceDate: string,
): NonNullable<CreatePageParameters["properties"]> {
	return {
		...synchronizedTaskProperties(template),
		...scheduledTaskDateProperties(template, occurrenceDate),
		[taskProperty.occurrenceKey]: richTextValue(
			`regular:${template.page.id}:${occurrenceDate}`,
		),
	};
}

function taskNeedsTemplateSync(page: PageObjectResponse, template: TaskTemplate): boolean {
	return (
		Option.getOrElse(titleProperty(page), () => "") !== template.name ||
		Option.getOrElse(richTextProperty(page, taskProperty.notes), () => "") !== template.notes ||
		!sameIds(relationPropertyIds(page, taskProperty.context), template.contextIds) ||
		!sameIds(relationPropertyIds(page, taskProperty.template), [template.page.id])
	);
}

function taskNeedsUpdate(
	page: PageObjectResponse,
	template: TaskTemplate,
	occurrenceDate: string,
): boolean {
	const expectedDates = scheduledTaskDates(template, occurrenceDate);
	return (
		taskNeedsTemplateSync(page, template) ||
		dateValue(page, taskProperty.start) !== expectedDates.start ||
		dateValue(page, taskProperty.due) !== (expectedDates.due ?? "") ||
		Option.getOrElse(richTextProperty(page, taskProperty.occurrenceKey), () => "") !==
			`regular:${template.page.id}:${occurrenceDate}`
	);
}

function dateValue(page: PageObjectResponse, property: string): string {
	return Option.getOrElse(datePropertyStart(page, property), () => "").slice(0, 10);
}

function sameIds(actual: Option.Option<ReadonlyArray<string>>, expected: ReadonlyArray<string>) {
	if (Option.isNone(actual) || actual.value.length !== expected.length) {
		return false;
	}
	return [...actual.value].sort().every((id, index) => id === [...expected].sort()[index]);
}

class InvalidTemplateScheduleError extends Data.TaggedError("InvalidTemplateScheduleError")<{
	readonly templateId: string;
}> {}
