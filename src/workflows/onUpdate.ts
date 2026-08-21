import { type CreatePageParameters, type PageObjectResponse } from "@notionhq/client";
import { NotionPageUpdatedEvent, triggers } from "@notionhq/workers/alpha/triggers";
import { createWorkflow } from "@notionhq/workers/alpha/workflow";
import { NodeServices } from "@effect/platform-node";
import { Data, DateTime, Effect, Layer, Option } from "effect";
import { easternDate, futureDueDates } from "../lib/dateUtils.js";
import { EffectStep, effectStepLayer } from "../lib/effectStep.js";
import { NotionEffect, notionEffectLayer } from "../lib/notionEffect.js";

const dynamicProperties = new Set([
	"Status",
	"Due",
	"Completed At",
	"Repeat Regularly",
	"Repeat on Completion",
	"Repeat Of",
]);

/**
 * Synchronizes the next six months of a task's regularly repeating occurrences.
 */
export default createWorkflow({
	name: "Sync regularly repeating tasks",
	description: "Creates and reconciles future task occurrences from a Repeat Regularly RRULE.",
	triggers: [triggers.notionPageUpdated()],
	handler: (event, context) =>
		Effect.runPromise(
			program(event).pipe(
				Effect.provide(
					Layer.mergeAll(
						NodeServices.layer,
						effectStepLayer(context.step),
						notionEffectLayer(context.notion),
					),
				),
			),
		),
});

const program = Effect.fn(function* (event: NotionPageUpdatedEvent) {
	const pageId = event.url?.split("/").at(-1);
	if (!pageId) {
		return;
	}

	const step = yield* EffectStep;
	const notion = yield* NotionEffect;
	const source = yield* step("Get source task", notion.pages.retrieve({ page_id: pageId }));

	const repeatValue = source.properties["Repeat Regularly"];
	const dueValue = source.properties.Due;
	if (repeatValue?.type !== "rich_text" || dueValue?.type !== "date" || !dueValue.date) {
		return;
	}

	const scheduleWindow = yield* step(
		"Determine schedule window",
		DateTime.now.pipe(Effect.map((now) => ({ now: DateTime.formatIso(now) }))),
	);
	const schedule = Option.all({
		cutoff: easternDate(scheduleWindow.now),
		dueDates: futureDueDates(
			repeatValue.rich_text.map((text) => text.plain_text).join(""),
			dueValue.date.start,
			scheduleWindow.now,
		),
	});
	if (Option.isNone(schedule)) {
		return;
	}
	const { cutoff, dueDates } = schedule.value;

	const sourceDataSourceId = yield* dataSourceId(source);
	const occurrences = yield* step(
		"Get repeating occurrences",
		notion.dataSources.queryPages({
			data_source_id: sourceDataSourceId,
			filter: { property: "Repeat Of", relation: { contains: source.id } },
		}),
	);

	const futureOccurrences = occurrences
		.filter((occurrence) => occurrenceDueDate(occurrence) > cutoff)
		.sort((left, right) => occurrenceDueDate(left).localeCompare(occurrenceDueDate(right)));
	const unmatchedOccurrences = [...futureOccurrences];
	const unmatchedDueDates = [...dueDates];

	for (const dueDate of dueDates) {
		const occurrenceIndex = unmatchedOccurrences.findIndex(
			(occurrence) => occurrenceDueDate(occurrence) === dueDate,
		);
		if (occurrenceIndex === -1) {
			continue;
		}

		const occurrence = unmatchedOccurrences.splice(occurrenceIndex, 1)[0];
		unmatchedDueDates.splice(unmatchedDueDates.indexOf(dueDate), 1);
		yield* step(
			"Sync occurrence",
			{ key: ["sync-occurrence", occurrence.id] },
			notion.pages.update({
				page_id: occurrence.id,
				properties: staticTaskProperties(source),
				is_locked: true,
			}),
		);
	}

	for (const [index, occurrence] of unmatchedOccurrences.entries()) {
		const dueDate = unmatchedDueDates[index];
		if (!dueDate) {
			break;
		}

		yield* step(
			"Reschedule occurrence",
			{ key: ["reschedule-occurrence", occurrence.id] },
			notion.pages.update({
				page_id: occurrence.id,
				properties: {
					...staticTaskProperties(source),
					Due: { date: { start: dueDate } },
				},
				is_locked: true,
			}),
		);
	}

	const rescheduledCount = Math.min(unmatchedOccurrences.length, unmatchedDueDates.length);
	for (const occurrence of unmatchedOccurrences.slice(rescheduledCount)) {
		yield* step(
			"Archive occurrence",
			{ key: ["archive-occurrence", occurrence.id] },
			notion.pages.update({ page_id: occurrence.id, in_trash: true }),
		);
	}

	for (const dueDate of unmatchedDueDates.slice(rescheduledCount)) {
		const occurrence = yield* step(
			"Create occurrence",
			{ key: ["create-occurrence", dueDate] },
			notion.pages.create({
				parent: { data_source_id: sourceDataSourceId },
				properties: occurrenceProperties(source, dueDate),
				children: [],
			}),
		);
		yield* step(
			"Lock occurrence",
			{ key: ["lock-occurrence", occurrence.id] },
			notion.pages.update({ page_id: occurrence.id, is_locked: true }),
		);
	}
});

function dataSourceId(page: PageObjectResponse): Effect.Effect<string, InvalidDataSourceError> {
	if (page.parent.type === "data_source_id") {
		return Effect.succeed(page.parent.data_source_id);
	}

	return Effect.fail(new InvalidDataSourceError({ pageId: page.id }));
}

function occurrenceDueDate(page: PageObjectResponse): string {
	const dueValue = page.properties.Due;
	if (dueValue?.type !== "date" || !dueValue.date) {
		return "";
	}

	return dueValue.date.start.slice(0, 10);
}

function staticTaskProperties(
	page: PageObjectResponse,
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
		"checkbox",
		"relation",
		"files",
		"place",
		"verification",
	]);
	const properties = Object.fromEntries(
		Object.entries(page.properties)
			.filter(
				([name, property]) =>
					!dynamicProperties.has(name) && writableTypes.has(property.type),
			)
			.map(([name, property]) => {
				const { id: _id, ...value } = property;
				return [name, value];
			}),
	);

	return properties as NonNullable<CreatePageParameters["properties"]>;
}

function occurrenceProperties(
	source: PageObjectResponse,
	dueDate: string,
): NonNullable<CreatePageParameters["properties"]> {
	return {
		...staticTaskProperties(source),
		Status: { status: { name: "Not started" } },
		Due: { date: { start: dueDate } },
		"Completed At": { date: null },
		"Repeat Of": { relation: [{ id: source.id }] },
	};
}

class InvalidDataSourceError extends Data.TaggedError("InvalidDataSourceError")<{
	readonly pageId: string;
}> {}
