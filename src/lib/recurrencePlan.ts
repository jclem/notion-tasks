import type { PageObjectResponse } from "@notionhq/client";
import { Array, Option, Order, pipe } from "effect";
import { datePropertyStart } from "./notionProperties.js";

/** A scheduled-date update for an existing regularly repeating occurrence. */
export type PlannedOccurrence = {
	readonly occurrence: PageObjectResponse;
	readonly occurrenceDate: string;
};

/** The deterministic actions needed to reconcile regularly repeating occurrences. */
export type RecurrencePlan = {
	readonly synchronize: ReadonlyArray<PlannedOccurrence>;
	readonly reschedule: ReadonlyArray<PlannedOccurrence>;
	readonly archive: ReadonlyArray<PageObjectResponse>;
	readonly create: ReadonlyArray<string>;
};

/**
 * Plans how existing future occurrences should match a desired set of scheduled dates.
 *
 * Exact scheduled-date matches are synchronized in place. Remaining occurrences are
 * paired with remaining dates in order, after which excess occurrences are
 * archived and excess scheduled dates are created.
 *
 * @param occurrences - Existing occurrences related to the source task.
 * @param occurrenceDates - Desired future dates in recurrence order.
 * @param cutoff - The current Eastern calendar date, which existing occurrences must not precede.
 * @param primaryDateProperty - Task property that normally stores the scheduled date.
 * @param fallbackDateProperty - Previous date property used while migrating a template.
 * @returns An immutable reconciliation plan.
 */
export function recurrencePlan(
	occurrences: ReadonlyArray<PageObjectResponse>,
	occurrenceDates: ReadonlyArray<string>,
	cutoff: string,
	primaryDateProperty = "Due",
	fallbackDateProperty?: string,
): RecurrencePlan {
	const futureOccurrences = pipe(
		occurrences,
		Array.flatMap((occurrence) =>
			occurrenceScheduleDate(
				occurrence,
				primaryDateProperty,
				fallbackDateProperty,
				cutoff,
			).pipe(
				Option.map((occurrenceDate) => ({ occurrence, occurrenceDate })),
				Array.fromOption,
			),
		),
		Array.sortWith(({ occurrenceDate }) => occurrenceDate, Order.String),
	);
	const matches = pipe(
		occurrenceDates,
		Array.reduce(
			{
				synchronize: [] as PlannedOccurrence[],
				unmatchedOccurrences: futureOccurrences,
				unmatchedOccurrenceDates: [] as string[],
			},
			(state, occurrenceDate) =>
				pipe(
					state.unmatchedOccurrences,
					Array.findFirstIndex(
						(occurrence) => occurrence.occurrenceDate === occurrenceDate,
					),
					Option.match({
						onNone: () => ({
							...state,
							unmatchedOccurrenceDates: Array.append(
								state.unmatchedOccurrenceDates,
								occurrenceDate,
							),
						}),
						onSome: (index) => ({
							...state,
							synchronize: Array.append(state.synchronize, {
								occurrence: state.unmatchedOccurrences[index].occurrence,
								occurrenceDate,
							}),
							unmatchedOccurrences: Array.remove(state.unmatchedOccurrences, index),
						}),
					}),
				),
		),
	);

	return {
		synchronize: matches.synchronize,
		reschedule: pipe(
			Array.zip(matches.unmatchedOccurrences, matches.unmatchedOccurrenceDates),
			Array.map(([{ occurrence }, occurrenceDate]) => ({ occurrence, occurrenceDate })),
		),
		archive: pipe(
			matches.unmatchedOccurrences,
			Array.drop(matches.unmatchedOccurrenceDates.length),
			Array.map(({ occurrence }) => occurrence),
		),
		create: pipe(
			matches.unmatchedOccurrenceDates,
			Array.drop(matches.unmatchedOccurrences.length),
		),
	};
}

function occurrenceScheduleDate(
	page: PageObjectResponse,
	primaryProperty: string,
	fallbackProperty: string | undefined,
	cutoff: string,
): Option.Option<string> {
	return pipe(
		[primaryProperty, fallbackProperty].filter((name): name is string => name !== undefined),
		Array.findFirst((name) =>
			datePropertyStart(page, name).pipe(
				Option.map((start) => start.slice(0, 10)),
				Option.exists((date) => date >= cutoff),
			),
		),
		Option.flatMap((name) => datePropertyStart(page, name)),
		Option.map((start) => start.slice(0, 10)),
	);
}
