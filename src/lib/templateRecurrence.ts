import type { CreatePageParameters, PageObjectResponse } from "@notionhq/client";
import { Data, Effect, Option, pipe } from "effect";
import { easternDate, futureDueDates } from "./dateUtils.js";
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
	relationValue,
	repeatMode,
	richTextValue,
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
	let instances = yield* queryTemplateInstances(tasksDataSourceId, template.page.id);

	if (!template.enabled) {
		yield* synchronizeInstances(template, instances);
		return;
	}

	const templateMarkdown = yield* notion.pages.retrieveMarkdown({ page_id: template.page.id });
	const root = yield* ensureRootTask(template, tasksDataSourceId, instances, templateMarkdown);
	for (const duplicateId of root.duplicateIds) {
		yield* notion.pages.update({ page_id: duplicateId, in_trash: true });
	}
	instances = instances.filter((instance) => !root.duplicateIds.includes(instance.id));
	if (root.created) {
		instances = [...instances, root.page];
	}
	yield* synchronizeInstances(template, instances);

	if (template.mode !== repeatMode.regularly) {
		return;
	}

	const schedule = Option.all({
		cutoff: easternDate(now),
		dueDates: futureDueDates(template.compiled.rrule, template.starts, now),
	});
	if (Option.isNone(schedule)) {
		return yield* Effect.fail(
			new InvalidTemplateScheduleError({ templateId: template.page.id }),
		);
	}

	const plan = recurrencePlan(instances, schedule.value.dueDates, schedule.value.cutoff);
	for (const occurrence of plan.synchronize) {
		const dueDate = Option.getOrElse(datePropertyStart(occurrence, taskProperty.due), () => "");
		const properties = regularOccurrenceUpdateProperties(template, root.page.id, dueDate);
		if (taskNeedsUpdate(occurrence, template, root.page.id, dueDate)) {
			yield* notion.pages.update({
				page_id: occurrence.id,
				properties,
				is_locked: true,
			});
		}
	}

	for (const { occurrence, dueDate } of plan.reschedule) {
		yield* notion.pages.update({
			page_id: occurrence.id,
			properties: regularOccurrenceUpdateProperties(template, root.page.id, dueDate),
			is_locked: true,
		});
	}

	for (const occurrence of plan.archive) {
		yield* notion.pages.update({ page_id: occurrence.id, in_trash: true });
	}

	for (const dueDate of plan.create) {
		const occurrence = yield* notion.pages.create({
			parent: { data_source_id: tasksDataSourceId },
			properties: regularOccurrenceCreateProperties(template, root.page.id, dueDate),
			markdown: templateMarkdown,
		});
		yield* notion.pages.update({ page_id: occurrence.id, is_locked: true });
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

function ensureRootTask(
	template: TaskTemplate,
	tasksDataSourceId: string,
	instances: ReadonlyArray<PageObjectResponse>,
	templateMarkdown: string,
) {
	return Effect.gen(function* () {
		const notion = yield* NotionEffect;
		const configuredRootId = Option.getOrUndefined(template.rootTaskId);
		const rootOccurrenceKey = `root:${template.page.id}`;
		const rootKeyInstances = instances.filter(
			(page) =>
				Option.getOrElse(richTextProperty(page, taskProperty.occurrenceKey), () => "") ===
				rootOccurrenceKey,
		);
		const relatedRootId = pipe(
			instances,
			Option.fromIterable,
			Option.flatMap((page) => relationPropertyIds(page, taskProperty.repeatOf)),
			Option.flatMap((ids) => Option.fromNullishOr(ids[0])),
			Option.getOrUndefined,
		);
		const rootId =
			rootKeyInstances[0]?.id ?? configuredRootId ?? relatedRootId ?? instances[0]?.id;

		if (rootId) {
			const page =
				instances.find((instance) => instance.id === rootId) ??
				(yield* notion.pages.retrieve({ page_id: rootId }));
			yield* ensureRootRelations(template, page);
			return {
				page,
				created: false,
				duplicateIds: rootKeyInstances.slice(1).map(({ id }) => id),
			} as const;
		}

		const page = yield* notion.pages.create({
			parent: { data_source_id: tasksDataSourceId },
			properties: {
				...newTaskProperties(
					template,
					template.page.id,
					template.starts,
					`root:${template.page.id}`,
				),
				[taskProperty.repeatOf]: relationValue([]),
			},
			markdown: templateMarkdown,
		});
		yield* ensureRootRelations(template, page);
		return { page, created: true, duplicateIds: [] as ReadonlyArray<string> } as const;
	});
}

function ensureRootRelations(template: TaskTemplate, root: PageObjectResponse) {
	return Effect.gen(function* () {
		const notion = yield* NotionEffect;
		const rootIds = Option.getOrElse(
			relationPropertyIds(root, taskProperty.repeatOf),
			() => [] as ReadonlyArray<string>,
		);
		if (rootIds.length !== 1 || rootIds[0] !== root.id) {
			yield* notion.pages.update({
				page_id: root.id,
				properties: { [taskProperty.repeatOf]: relationValue([root.id]) },
			});
		}

		if (Option.getOrUndefined(template.rootTaskId) !== root.id) {
			yield* notion.pages.update({
				page_id: template.page.id,
				properties: { [templateProperty.rootTask]: relationValue([root.id]) },
			});
		}
	});
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
	rootTaskId: string,
	dueDate: string,
): NonNullable<CreatePageParameters["properties"]> {
	return newTaskProperties(
		template,
		rootTaskId,
		dueDate,
		`regular:${template.page.id}:${dueDate}`,
	);
}

function regularOccurrenceUpdateProperties(
	template: TaskTemplate,
	rootTaskId: string,
	dueDate: string,
): NonNullable<CreatePageParameters["properties"]> {
	return {
		...synchronizedTaskProperties(template),
		[taskProperty.due]: { date: { start: dueDate } },
		[taskProperty.repeatOf]: relationValue([rootTaskId]),
		[taskProperty.occurrenceKey]: richTextValue(`regular:${template.page.id}:${dueDate}`),
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
	rootTaskId: string,
	dueDate: string,
): boolean {
	return (
		taskNeedsTemplateSync(page, template) ||
		Option.getOrElse(datePropertyStart(page, taskProperty.due), () => "").slice(0, 10) !==
			dueDate ||
		Option.getOrElse(richTextProperty(page, taskProperty.occurrenceKey), () => "") !==
			`regular:${template.page.id}:${dueDate}` ||
		!sameIds(relationPropertyIds(page, taskProperty.repeatOf), [rootTaskId]) ||
		!page.is_locked
	);
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
