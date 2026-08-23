import { createHash } from "node:crypto";
import type {
	Client,
	CreatePageParameters,
	GetPageParameters,
	PageObjectResponse,
	QueryDataSourceParameters,
	UpdatePageParameters,
} from "@notionhq/client";
import { Context, Data, Effect, Layer, Option, Stream } from "effect";
import { RateLimiter } from "effect/unstable/persistence";
import { EffectStep } from "./effectStep.js";

const rateLimiterLayer = RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory));
type GetPageMarkdownParameters = Parameters<Client["pages"]["retrieveMarkdown"]>[0];

/** The maximum number of Notion API requests started per second. */
export const notionRequestsPerSecond = 3;

/** Durable, rate-limited Effect service for complete-page Notion API operations. */
export class NotionEffect extends Context.Service<
	NotionEffect,
	Effect.Success<ReturnType<typeof makeNotionEffect>>
>()("notion-tasks/NotionEffect") {}

/**
 * Provides the durable, rate-limited Effect Notion service for a workflow invocation.
 *
 * @param client - The Notion SDK client supplied by the workflow context.
 * @returns A layer containing the Effect Notion service and its limiter, requiring
 * the Effect step service used to make each operation durable.
 */
export function notionEffectLayer(client: Client) {
	return Layer.effect(NotionEffect, makeNotionEffect(client)).pipe(
		Layer.provide(rateLimiterLayer),
	);
}

/**
 * Creates a durable, rate-limited Effect wrapper around the Notion SDK client.
 *
 * Every public operation creates a durable step keyed by its name and a SHA-256
 * hash of its JSON-serialized arguments. Requests are limited to three calls per
 * second. Page-returning operations fail unless the API supplies a complete page
 * object with properties. Markdown reads fail rather than silently returning a
 * truncated page or omitting unsupported blocks.
 *
 * @param client - The Notion SDK client supplied by the workflow context.
 * @returns An Effect that produces the wrapped Notion operations.
 */
const makeNotionEffect = Effect.fn(function* (client: Client) {
	const step = yield* EffectStep;
	const withRateLimiter = yield* RateLimiter.makeWithRateLimiter;
	const operation = <A, E>(name: string, arguments_: unknown, effect: Effect.Effect<A, E>) =>
		Effect.gen(function* () {
			const argumentsHash = yield* hashArguments(arguments_);
			return yield* step(name, { key: [name, argumentsHash] }, effect);
		});
	const request = <A>(operation: string, run: () => Promise<A>) =>
		Effect.tryPromise({
			try: run,
			catch: (cause) => new NotionRequestError({ operation, cause }),
		}).pipe(
			withRateLimiter({
				key: "notion-api",
				limit: notionRequestsPerSecond,
				window: "1 second",
				onExceeded: "delay",
				algorithm: "token-bucket",
			}),
		);

	const fullPage = (operation: string, page: unknown) => {
		return Effect.succeed(page).pipe(
			Effect.filterOrFail(isFullPage, () => new FullPageExpectedError({ operation })),
		);
	};
	const completeMarkdown = (
		operation: string,
		response: Awaited<ReturnType<Client["pages"]["retrieveMarkdown"]>>,
	) =>
		response.truncated || response.unknown_block_ids.length > 0
			? Effect.fail(
					new CompletePageMarkdownExpectedError({
						operation,
						truncated: response.truncated,
						unknownBlockIds: response.unknown_block_ids,
					}),
				)
			: Effect.succeed(response.markdown);

	return {
		pages: {
			retrieve: (parameters: GetPageParameters) =>
				operation(
					"pages.retrieve",
					parameters,
					request("pages.retrieve", () => client.pages.retrieve(parameters)).pipe(
						Effect.flatMap((page) => fullPage("pages.retrieve", page)),
					),
				),
			create: (parameters: CreatePageParameters) =>
				operation(
					"pages.create",
					parameters,
					request("pages.create", () => client.pages.create(parameters)).pipe(
						Effect.flatMap((page) => fullPage("pages.create", page)),
					),
				),
			update: (parameters: UpdatePageParameters) =>
				operation(
					"pages.update",
					parameters,
					request("pages.update", () => client.pages.update(parameters)).pipe(
						Effect.flatMap((page) => fullPage("pages.update", page)),
					),
				),
			retrieveMarkdown: (parameters: GetPageMarkdownParameters) =>
				operation(
					"pages.retrieveMarkdown",
					parameters,
					request("pages.retrieveMarkdown", () =>
						client.pages.retrieveMarkdown(parameters),
					).pipe(
						Effect.flatMap((response) =>
							completeMarkdown("pages.retrieveMarkdown", response),
						),
					),
				),
		},
		dataSources: {
			queryPages: (parameters: QueryDataSourceParameters) =>
				operation(
					"dataSources.queryPages",
					parameters,
					Stream.paginate(parameters.start_cursor, (cursor) =>
						request("dataSources.query", () =>
							client.dataSources.query({
								...parameters,
								result_type: "page",
								page_size: parameters.page_size ?? 100,
								start_cursor: cursor,
							}),
						).pipe(
							Effect.flatMap((response) =>
								Effect.forEach(response.results, (result) =>
									fullPage("dataSources.query", result),
								).pipe(
									Effect.map(
										(pages) =>
											[
												pages,
												Option.fromNullishOr(
													response.has_more ? response.next_cursor : null,
												),
											] as const,
									),
								),
							),
						),
					).pipe(Stream.runCollect),
				),
		},
	};
});

function hashArguments(arguments_: unknown): Effect.Effect<string, ArgumentsHashError> {
	return Effect.try({
		try: () => {
			const serialized = JSON.stringify(arguments_) ?? "undefined";
			return createHash("sha256").update(serialized).digest("hex");
		},
		catch: (cause) => new ArgumentsHashError({ cause }),
	});
}

function isFullPage(value: unknown): value is PageObjectResponse {
	return (
		typeof value === "object" &&
		value !== null &&
		"object" in value &&
		value.object === "page" &&
		"url" in value &&
		"properties" in value
	);
}

class NotionRequestError extends Data.TaggedError("NotionRequestError")<{
	readonly operation: string;
	readonly cause: unknown;
}> {}

class FullPageExpectedError extends Data.TaggedError("FullPageExpectedError")<{
	readonly operation: string;
}> {}

class CompletePageMarkdownExpectedError extends Data.TaggedError(
	"CompletePageMarkdownExpectedError",
)<{
	readonly operation: string;
	readonly truncated: boolean;
	readonly unknownBlockIds: ReadonlyArray<string>;
}> {}

class ArgumentsHashError extends Data.TaggedError("ArgumentsHashError")<{
	readonly cause: unknown;
}> {}
