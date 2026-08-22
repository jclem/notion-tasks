import { type CreatePageParameters, type PageObjectResponse } from "@notionhq/client";
import { NotionPageUpdatedEvent, triggers } from "@notionhq/workers/alpha/triggers";
import { createWorkflow } from "@notionhq/workers/alpha/workflow";
import { Data, DateTime, Effect, HashSet, Match, Option, pipe, Record, Result } from "effect";
import { easternDate, futureDueDates } from "../lib/dateUtils.js";
import { EffectStep } from "../lib/effectStep.js";
import { NotionEffect, notionRequestsPerSecond } from "../lib/notionEffect.js";
import { datePropertyStart, richTextProperty } from "../lib/notionProperties.js";
import { recurrencePlan } from "../lib/recurrencePlan.js";
import { workflowLayer } from "../lib/workflowLayer.js";

/**
 * Synchronizes the next six months of a task's regularly repeating occurrences.
 */
export default createWorkflow({
	name: "Sync regularly repeating tasks",
	description: "Creates and reconciles future task occurrences from a Repeat Regularly RRULE.",
	triggers: [triggers.notionPageUpdated()],
	handler: (event, context) =>
		Effect.runPromise(program(event).pipe(Effect.provide(workflowLayer(context)))),
});

const program = Effect.fn(function* (event: NotionPageUpdatedEvent) {
	const pageId = event.url?.split("/").at(-1);
	if (!pageId) {
		return;
	}

	const step = yield* EffectStep;
	const notion = yield* NotionEffect;
	const source = yield* notion.pages.retrieve({ page_id: pageId });

	const recurrence = Option.all({
		recurrenceRule: richTextProperty(source, "Repeat Regularly"),
		dueDate: datePropertyStart(source, "Due"),
	});
	if (Option.isNone(recurrence)) {
		return;
	}

	const scheduleWindow = yield* step(
		"Determine schedule window",
		DateTime.now.pipe(Effect.map((now) => ({ now: DateTime.formatIso(now) }))),
	);
	const schedule = Option.all({
		cutoff: easternDate(scheduleWindow.now),
		dueDates: futureDueDates(
			recurrence.value.recurrenceRule,
			recurrence.value.dueDate,
			scheduleWindow.now,
		),
	});
	if (Option.isNone(schedule)) {
		return;
	}
	const { cutoff, dueDates } = schedule.value;

	const sourceDataSourceId = yield* dataSourceId(source);
	const occurrences = yield* notion.dataSources.queryPages({
		data_source_id: sourceDataSourceId,
		filter: { property: "Repeat Of", relation: { contains: source.id } },
	});
	const plan = recurrencePlan(occurrences, dueDates, cutoff);
	const staticProperties = staticTaskProperties(source);

	yield* pipe(
		plan.synchronize,
		Effect.forEach(
			(occurrence) =>
				notion.pages.update({
					page_id: occurrence.id,
					properties: staticProperties,
					is_locked: true,
				}),
			{ discard: true },
		),
	);
	yield* pipe(
		plan.reschedule,
		Effect.forEach(
			({ occurrence, dueDate }) =>
				notion.pages.update({
					page_id: occurrence.id,
					properties: {
						...staticProperties,
						Due: { date: { start: dueDate } },
					},
					is_locked: true,
				}),
			{ discard: true },
		),
	);
	yield* pipe(
		plan.archive,
		Effect.forEach(
			(occurrence) => notion.pages.update({ page_id: occurrence.id, in_trash: true }),
			{ discard: true },
		),
	);
	yield* pipe(
		plan.create,
		Effect.forEach(
			(dueDate) =>
				Effect.gen(function* () {
					const occurrence = yield* notion.pages.create({
						parent: { data_source_id: sourceDataSourceId },
						properties: occurrenceProperties(source, dueDate),
						children: [],
					});
					yield* notion.pages.update({ page_id: occurrence.id, is_locked: true });
				}),
			{ concurrency: notionRequestsPerSecond, discard: true },
		),
	);
});

function dataSourceId(page: PageObjectResponse): Effect.Effect<string, InvalidDataSourceError> {
	return Match.value(page.parent).pipe(
		Match.when({ type: "data_source_id" }, ({ data_source_id }) =>
			Effect.succeed(data_source_id),
		),
		Match.orElse(() => Effect.fail(new InvalidDataSourceError({ pageId: page.id }))),
	);
}

function staticTaskProperties(
	page: PageObjectResponse,
): NonNullable<CreatePageParameters["properties"]> {
	const properties = pipe(
		page.properties,
		Record.filterMap((property, name) => {
			if (
				HashSet.has(dynamicProperties, name) ||
				!HashSet.has(writableStaticPropertyTypes, property.type)
			) {
				return Result.failVoid;
			}

			const { id: _id, ...value } = property;
			return Result.succeed(value);
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

const dynamicProperties: HashSet.HashSet<string> = HashSet.make(
	"Status",
	"Due",
	"Completed At",
	"Repeat Regularly",
	"Repeat on Completion",
	"Repeat Of",
);
const writableStaticPropertyTypes: HashSet.HashSet<string> = HashSet.make(
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
);
