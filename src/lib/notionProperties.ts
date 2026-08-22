import type { PageObjectResponse } from "@notionhq/client";
import { Array, Option, pipe } from "effect";

/**
 * Reads the concatenated plain text from a rich-text page property.
 *
 * @param page - The complete Notion page containing the property.
 * @param name - The property name to read.
 * @returns The property's text when it exists and has the expected type.
 */
export function richTextProperty(page: PageObjectResponse, name: string): Option.Option<string> {
	return Option.fromNullishOr(page.properties[name]).pipe(
		Option.filter(isRichTextProperty),
		Option.map(({ rich_text }) =>
			pipe(
				rich_text,
				Array.map(({ plain_text }) => plain_text),
				Array.join(""),
			),
		),
	);
}

/**
 * Reads the start value from a populated date page property.
 *
 * @param page - The complete Notion page containing the property.
 * @param name - The property name to read.
 * @returns The date start when it exists and has the expected type.
 */
export function datePropertyStart(page: PageObjectResponse, name: string): Option.Option<string> {
	return Option.fromNullishOr(page.properties[name]).pipe(
		Option.filter(isDateProperty),
		Option.flatMap(({ date }) => Option.fromNullishOr(date)),
		Option.map(({ start }) => start),
	);
}

type PageProperty = PageObjectResponse["properties"][string];
type RichTextProperty = Extract<PageProperty, { type: "rich_text" }>;
type DateProperty = Extract<PageProperty, { type: "date" }>;

function isRichTextProperty(property: PageProperty): property is RichTextProperty {
	return property.type === "rich_text";
}

function isDateProperty(property: PageProperty): property is DateProperty {
	return property.type === "date";
}
