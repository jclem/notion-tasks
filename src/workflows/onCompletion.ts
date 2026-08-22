import { type CreatePageParameters, type PageObjectResponse } from "@notionhq/client";
import { NotionPageUpdatedEvent, triggers } from "@notionhq/workers/alpha/triggers";
import { createWorkflow } from "@notionhq/workers/alpha/workflow";
import { NodeServices } from "@effect/platform-node";
import { Data, Effect, Layer, Option } from "effect";
import { dueDateFromCompletion } from "../lib/dateUtils.js";
import { effectStepLayer } from "../lib/effectStep.js";
import { NotionEffect, notionEffectLayer } from "../lib/notionEffect.js";

/**
 * Records a task's completion time and creates its next occurrence when it has
 * a supported Repeat on Completion value.
 */
export default createWorkflow({
	name: "On Completion",
	description: "Processes tasks upon completion",
	triggers: [triggers.notionPageUpdated()],
	handler: (event, context) =>
		Effect.runPromise(
			program(event).pipe(
				Effect.provide(
					Layer.merge(
						NodeServices.layer,
						notionEffectLayer(context.notion).pipe(
							Layer.provideMerge(effectStepLayer(context.step)),
						),
					),
				),
			),
		),
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

	const repeatValue = page.properties["Repeat on Completion"];
	if (repeatValue?.type !== "rich_text") {
		return;
	}

	const due = dueDateFromCompletion(
		completedAt,
		repeatValue.rich_text.map((text) => text.plain_text).join(""),
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
	if (page.parent.type === "data_source_id") {
		return Effect.succeed({ data_source_id: page.parent.data_source_id });
	}
	if (page.parent.type === "database_id") {
		return Effect.succeed({ database_id: page.parent.database_id });
	}

	return Effect.fail(new InvalidPageParentError({ pageId: page.id }));
}

function repeatedTaskProperties(
	page: PageObjectResponse,
	due: string,
): NonNullable<CreatePageParameters["properties"]> {
	const writableTypes = new Set([
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
	]);
	const properties = Object.fromEntries(
		Object.entries(page.properties)
			.filter(([, property]) => writableTypes.has(property.type))
			.map(([name, property]) => {
				const { id: _id, ...value } = property;
				return [name, value];
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
