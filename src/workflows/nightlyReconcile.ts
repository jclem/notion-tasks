import { triggers } from "@notionhq/workers/alpha/triggers";
import { createWorkflow } from "@notionhq/workers/alpha/workflow";
import { DateTime, Effect } from "effect";
import { EffectStep } from "../lib/effectStep.js";
import { NotionEffect } from "../lib/notionEffect.js";
import { readTaskConfig } from "../lib/taskConfig.js";
import { parseTaskTemplate, repeatMode, templateProperty } from "../lib/taskTemplate.js";
import { reconcileTemplate, updateTemplateDiagnostics } from "../lib/templateRecurrence.js";
import { workflowLayer } from "../lib/workflowLayer.js";

/** Maintains six months of regularly repeating tasks once per scheduled run. */
export default createWorkflow({
	name: "Nightly recurrence sweep",
	description: "Ensures every enabled regular template has six months of task instances.",
	triggers: [triggers.scheduled()],
	handler: (event, context) =>
		Effect.runPromise(program(event.timestamp).pipe(Effect.provide(workflowLayer(context)))),
});

const program = Effect.fn(function* (eventTimestamp: string | null) {
	const step = yield* EffectStep;
	const notion = yield* NotionEffect;
	const config = yield* step("Read task configuration", readTaskConfig);
	const now =
		eventTimestamp ??
		(yield* step(
			"Determine recurrence sweep time",
			DateTime.now.pipe(Effect.map(DateTime.formatIso)),
		));
	const templates = yield* notion.dataSources.queryPages({
		data_source_id: config.templatesDataSourceId,
		filter: {
			and: [
				{ property: templateProperty.enabled, checkbox: { equals: true } },
				{
					property: templateProperty.mode,
					select: { equals: repeatMode.regularly },
				},
			],
		},
		sorts: [{ timestamp: "created_time", direction: "ascending" }],
	});

	for (const page of templates) {
		const parsed = parseTaskTemplate(page);
		yield* updateTemplateDiagnostics(page, parsed);
		if (parsed.ok) {
			yield* reconcileTemplate(parsed.template, config.tasksDataSourceId, now);
		}
	}
});
