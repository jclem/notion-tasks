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

/** Reads the concatenated plain text from the page's title property. */
export function titleProperty(page: PageObjectResponse): Option.Option<string> {
	return pipe(
		Object.values(page.properties),
		Array.findFirst(isTitleProperty),
		Option.map(({ title }) =>
			pipe(
				title,
				Array.map(({ plain_text }) => plain_text),
				Array.join(""),
			),
		),
	);
}

/** Reads the selected option name from a select property. */
export function selectPropertyName(page: PageObjectResponse, name: string): Option.Option<string> {
	return Option.fromNullishOr(page.properties[name]).pipe(
		Option.filter(isSelectProperty),
		Option.flatMap(({ select }) => Option.fromNullishOr(select)),
		Option.map(({ name }) => name),
	);
}

/** Reads a checkbox property. */
export function checkboxProperty(page: PageObjectResponse, name: string): Option.Option<boolean> {
	return Option.fromNullishOr(page.properties[name]).pipe(
		Option.filter(isCheckboxProperty),
		Option.map(({ checkbox }) => checkbox),
	);
}

/** Reads a populated number property. */
export function numberProperty(page: PageObjectResponse, name: string): Option.Option<number> {
	return Option.fromNullishOr(page.properties[name]).pipe(
		Option.filter(isNumberProperty),
		Option.flatMap(({ number }) => Option.fromNullishOr(number)),
	);
}

/** Reads all visible page IDs from a relation property. */
export function relationPropertyIds(
	page: PageObjectResponse,
	name: string,
): Option.Option<ReadonlyArray<string>> {
	return Option.fromNullishOr(page.properties[name]).pipe(
		Option.filter(isRelationProperty),
		Option.map(({ relation }) => relation.map(({ id }) => id)),
	);
}

/** Reads the option name from a status property. */
export function statusPropertyName(page: PageObjectResponse, name: string): Option.Option<string> {
	return Option.fromNullishOr(page.properties[name]).pipe(
		Option.filter(isStatusProperty),
		Option.flatMap(({ status }) => Option.fromNullishOr(status)),
		Option.map(({ name }) => name),
	);
}

type PageProperty = PageObjectResponse["properties"][string];
type RichTextProperty = Extract<PageProperty, { type: "rich_text" }>;
type DateProperty = Extract<PageProperty, { type: "date" }>;
type TitleProperty = Extract<PageProperty, { type: "title" }>;
type SelectProperty = Extract<PageProperty, { type: "select" }>;
type CheckboxProperty = Extract<PageProperty, { type: "checkbox" }>;
type NumberProperty = Extract<PageProperty, { type: "number" }>;
type RelationProperty = Extract<PageProperty, { type: "relation" }>;
type StatusProperty = Extract<PageProperty, { type: "status" }>;

function isRichTextProperty(property: PageProperty): property is RichTextProperty {
	return property.type === "rich_text";
}

function isDateProperty(property: PageProperty): property is DateProperty {
	return property.type === "date";
}

function isTitleProperty(property: PageProperty): property is TitleProperty {
	return property.type === "title";
}

function isSelectProperty(property: PageProperty): property is SelectProperty {
	return property.type === "select";
}

function isCheckboxProperty(property: PageProperty): property is CheckboxProperty {
	return property.type === "checkbox";
}

function isNumberProperty(property: PageProperty): property is NumberProperty {
	return property.type === "number";
}

function isRelationProperty(property: PageProperty): property is RelationProperty {
	return property.type === "relation";
}

function isStatusProperty(property: PageProperty): property is StatusProperty {
	return property.type === "status";
}
