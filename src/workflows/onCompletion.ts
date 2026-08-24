import { triggers } from "@notionhq/workers/alpha/triggers";
import { createWorkflow } from "@notionhq/workers/alpha/workflow";
import { DateTime, Effect, Option } from "effect";
import { occurrenceDateFromCompletion } from "../lib/dateUtils.js";
import { EffectStep } from "../lib/effectStep.js";
import { NotionEffect } from "../lib/notionEffect.js";
import { pageIdFromUrl } from "../lib/notionIds.js";
import {
	datePropertyStart,
	relationPropertyIds,
	statusPropertyName,
} from "../lib/notionProperties.js";
import { readTaskConfig } from "../lib/taskConfig.js";
import {
	newTaskProperties,
	parseTaskTemplate,
	repeatMode,
	taskProperty,
} from "../lib/taskTemplate.js";
import { workflowLayer } from "../lib/workflowLayer.js";

/** Records completion and materializes one after-completion recurrence. */
export default createWorkflow({
	name: "Complete task",
	description:
		"Records completion and creates the next after-completion task with template content.",
	triggers: [triggers.notionPageUpdated()],
	handler: (event, context) =>
		Effect.runPromise(
			program(event.url, event.timestamp).pipe(Effect.provide(workflowLayer(context))),
		),
});

const program = Effect.fn(function* (url: string | null, eventTimestamp: string | null) {
	const pageId = pageIdFromUrl(url);
	if (Option.isNone(pageId)) {
		return;
	}

	const step = yield* EffectStep;
	const notion = yield* NotionEffect;
	const config = yield* step("Read task configuration", readTaskConfig);
	const page = yield* notion.pages.retrieve({ page_id: pageId.value });
	if (
		page.parent.type !== "data_source_id" ||
		page.parent.data_source_id !== config.tasksDataSourceId ||
		Option.getOrElse(statusPropertyName(page, taskProperty.status), () => "") !== "Done" ||
		Option.isSome(datePropertyStart(page, taskProperty.completedAt))
	) {
		return;
	}

	const completedAt =
		eventTimestamp ??
		(yield* step(
			"Determine completion time",
			DateTime.now.pipe(Effect.map(DateTime.formatIso)),
		));
	yield* notion.pages.update({
		page_id: page.id,
		properties: {
			[taskProperty.completedAt]: { date: { start: completedAt } },
		},
	});

	const templateId = relationPropertyIds(page, taskProperty.template).pipe(
		Option.flatMap((ids) => Option.fromNullishOr(ids[0])),
	);
	if (Option.isNone(templateId)) {
		return;
	}

	const templatePage = yield* notion.pages.retrieve({ page_id: templateId.value });
	const parsed = parseTaskTemplate(templatePage);
	if (
		!parsed.ok ||
		!parsed.template.enabled ||
		parsed.template.mode !== repeatMode.afterCompletion
	) {
		return;
	}

	const occurrenceDate = occurrenceDateFromCompletion(
		completedAt,
		parsed.template.compiled.rrule,
	);
	if (Option.isNone(occurrenceDate)) {
		return;
	}

	const occurrenceKey = `completion:${page.id}`;
	const existing = yield* notion.dataSources.queryPages({
		data_source_id: config.tasksDataSourceId,
		filter: {
			and: [
				{ property: taskProperty.template, relation: { contains: templatePage.id } },
				{ property: taskProperty.occurrenceKey, rich_text: { equals: occurrenceKey } },
			],
		},
		page_size: 1,
	});
	if (existing.length > 0) {
		return;
	}

	const templateMarkdown = yield* notion.pages.retrieveMarkdown({ page_id: templatePage.id });
	yield* notion.pages.create({
		parent: { data_source_id: config.tasksDataSourceId },
		properties: newTaskProperties(parsed.template, occurrenceDate.value, occurrenceKey),
		markdown: templateMarkdown,
	});
});
