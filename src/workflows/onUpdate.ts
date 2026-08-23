import { triggers } from "@notionhq/workers/alpha/triggers";
import { createWorkflow } from "@notionhq/workers/alpha/workflow";
import { DateTime, Effect, Option } from "effect";
import { EffectStep } from "../lib/effectStep.js";
import { NotionEffect } from "../lib/notionEffect.js";
import { pageIdFromUrl } from "../lib/notionIds.js";
import { readTaskConfig } from "../lib/taskConfig.js";
import { parseTaskTemplate } from "../lib/taskTemplate.js";
import { reconcileTemplate, updateTemplateDiagnostics } from "../lib/templateRecurrence.js";
import { workflowLayer } from "../lib/workflowLayer.js";

/** Compiles and reconciles a Task Template whenever it changes. */
export default createWorkflow({
	name: "Update task template",
	description: "Compiles a friendly schedule and synchronizes all task instances.",
	triggers: [triggers.notionPageCreated(), triggers.notionPageUpdated()],
	handler: (event, context) =>
		Effect.runPromise(
			program(event.url, event.timestamp).pipe(Effect.provide(workflowLayer(context))),
		),
});

const program = Effect.fn(function* (url: string | null, timestamp: string | null) {
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
		page.parent.data_source_id !== config.templatesDataSourceId
	) {
		return;
	}

	const parsed = parseTaskTemplate(page);
	yield* updateTemplateDiagnostics(page, parsed);
	if (!parsed.ok) {
		return;
	}

	const now =
		timestamp ??
		(yield* step(
			"Determine reconciliation time",
			DateTime.now.pipe(Effect.map(DateTime.formatIso)),
		));
	yield* reconcileTemplate(parsed.template, config.tasksDataSourceId, now);
});
