import { type CreatePageParameters, type PageObjectResponse } from "@notionhq/client";
import { NotionPageUpdatedEvent, triggers } from "@notionhq/workers/alpha/triggers";
import { createWorkflow } from "@notionhq/workers/alpha/workflow";
import { Data, Effect, HashSet, Match, Option, pipe, Record, Result } from "effect";
import { dueDateFromCompletion } from "../lib/dateUtils.js";
import { NotionEffect } from "../lib/notionEffect.js";
import { richTextProperty } from "../lib/notionProperties.js";
import { workflowLayer } from "../lib/workflowLayer.js";

/**
 * Records a task's completion time and creates its next occurrence when it has
 * a supported Repeat on Completion value.
 */
export default createWorkflow({
	name: "On Completion",
	description: "Processes tasks upon completion",
	triggers: [triggers.notionPageUpdated()],
	handler: (event, context) =>
		Effect.runPromise(program(event).pipe(Effect.provide(workflowLayer(context)))),
});

const program = Effect.fn(function* (event: NotionPageUpdatedEvent) {
	const pageId = event.url?.split("/").at(-1);
	const completedAt = event.timestamp;
	if (!pageId || !completedAt) {
		return;
	}

	const notion = yield* NotionEffect;
	const page = yield* notion.pages.retrieve({ page_id: pageId });

	yield* notion.pages.update({
		page_id: page.id,
		properties: {
			"Completed At": {
				date: { start: completedAt },
			},
		},
	});

	const due = richTextProperty(page, "Repeat on Completion").pipe(
		Option.flatMap((rule) => dueDateFromCompletion(completedAt, rule)),
	);
	if (Option.isNone(due)) {
		return;
	}

	const parent = yield* pageParent(page);
	yield* notion.pages.create({
		parent,
		properties: repeatedTaskProperties(page, due.value),
		children: [],
	});
});

function pageParent(
	page: PageObjectResponse,
): Effect.Effect<NonNullable<CreatePageParameters["parent"]>, InvalidPageParentError> {
	return Match.value(page.parent).pipe(
		Match.when({ type: "data_source_id" }, ({ data_source_id }) =>
			Effect.succeed({ data_source_id }),
		),
		Match.when({ type: "database_id" }, ({ database_id }) => Effect.succeed({ database_id })),
		Match.orElse(() => Effect.fail(new InvalidPageParentError({ pageId: page.id }))),
	);
}

function repeatedTaskProperties(
	page: PageObjectResponse,
	due: string,
): NonNullable<CreatePageParameters["properties"]> {
	const properties = pipe(
		page.properties,
		Record.filterMap((property) => {
			if (!HashSet.has(writablePropertyTypes, property.type)) {
				return Result.failVoid;
			}

			const { id: _id, ...value } = property;
			return Result.succeed(value);
		}),
	);

	return {
		...properties,
		"Completed At": { date: null },
		Due: { date: { start: due } },
		Status: { status: { name: "Not started" } },
	} satisfies NonNullable<CreatePageParameters["properties"]>;
}

class InvalidPageParentError extends Data.TaggedError("InvalidPageParentError")<{
	readonly pageId: string;
}> {}

const writablePropertyTypes: HashSet.HashSet<string> = HashSet.make(
	"title",
	"rich_text",
	"number",
	"url",
	"select",
	"multi_select",
	"people",
	"email",
	"phone_number",
	"date",
	"checkbox",
	"relation",
	"files",
	"status",
	"place",
	"verification",
);
