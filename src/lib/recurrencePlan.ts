import type { PageObjectResponse } from "@notionhq/client";
import { Array, Option, Order, pipe } from "effect";
import { datePropertyStart } from "./notionProperties.js";

/** A due-date update for an existing regularly repeating occurrence. */
export type RescheduledOccurrence = {
	readonly occurrence: PageObjectResponse;
	readonly dueDate: string;
};

/** The deterministic actions needed to reconcile regularly repeating occurrences. */
export type RecurrencePlan = {
	readonly synchronize: ReadonlyArray<PageObjectResponse>;
	readonly reschedule: ReadonlyArray<RescheduledOccurrence>;
	readonly archive: ReadonlyArray<PageObjectResponse>;
	readonly create: ReadonlyArray<string>;
};

/**
 * Plans how existing future occurrences should match a desired set of due dates.
 *
 * Exact due-date matches are synchronized in place. Remaining occurrences are
 * paired with remaining due dates in order, after which excess occurrences are
 * archived and excess due dates are created.
 *
 * @param occurrences - Existing occurrences related to the source task.
 * @param dueDates - Desired future due dates in recurrence order.
 * @param cutoff - The current Eastern calendar date, which existing occurrences must follow.
 * @returns An immutable reconciliation plan.
 */
export function recurrencePlan(
	occurrences: ReadonlyArray<PageObjectResponse>,
	dueDates: ReadonlyArray<string>,
	cutoff: string,
): RecurrencePlan {
	const futureOccurrences = pipe(
		occurrences,
		Array.flatMap((occurrence) =>
			occurrenceDueDate(occurrence).pipe(
				Option.filter((dueDate) => dueDate > cutoff),
				Option.map((dueDate) => ({ occurrence, dueDate })),
				Array.fromOption,
			),
		),
		Array.sortWith(({ dueDate }) => dueDate, Order.String),
	);
	const matches = pipe(
		dueDates,
		Array.reduce(
			{
				synchronize: [] as PageObjectResponse[],
				unmatchedOccurrences: futureOccurrences,
				unmatchedDueDates: [] as string[],
			},
			(state, dueDate) =>
				pipe(
					state.unmatchedOccurrences,
					Array.findFirstIndex((occurrence) => occurrence.dueDate === dueDate),
					Option.match({
						onNone: () => ({
							...state,
							unmatchedDueDates: Array.append(state.unmatchedDueDates, dueDate),
						}),
						onSome: (index) => ({
							...state,
							synchronize: Array.append(
								state.synchronize,
								state.unmatchedOccurrences[index].occurrence,
							),
							unmatchedOccurrences: Array.remove(state.unmatchedOccurrences, index),
						}),
					}),
				),
		),
	);

	return {
		synchronize: matches.synchronize,
		reschedule: pipe(
			Array.zip(matches.unmatchedOccurrences, matches.unmatchedDueDates),
			Array.map(([{ occurrence }, dueDate]) => ({ occurrence, dueDate })),
		),
		archive: pipe(
			matches.unmatchedOccurrences,
			Array.drop(matches.unmatchedDueDates.length),
			Array.map(({ occurrence }) => occurrence),
		),
		create: pipe(matches.unmatchedDueDates, Array.drop(matches.unmatchedOccurrences.length)),
	};
}

function occurrenceDueDate(page: PageObjectResponse): Option.Option<string> {
	return datePropertyStart(page, "Due").pipe(Option.map((start) => start.slice(0, 10)));
}
