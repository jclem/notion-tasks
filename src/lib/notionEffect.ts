import type {
	Client,
	CreatePageParameters,
	GetPageParameters,
	PageObjectResponse,
	QueryDataSourceParameters,
	UpdatePageParameters,
} from "@notionhq/client";
import { Context, Data, Effect, Layer } from "effect";
import { RateLimiter } from "effect/unstable/persistence";

const rateLimiterLayer = RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory));

/** Rate-limited Effect service for complete-page Notion API operations. */
export class NotionEffect extends Context.Service<
	NotionEffect,
	Effect.Success<ReturnType<typeof makeNotionEffect>>
>()("notion-tasks/NotionEffect") {}

/**
 * Provides the rate-limited Effect Notion service for a workflow invocation.
 *
 * @param client - The Notion SDK client supplied by the workflow context.
 * @returns A layer containing the Effect Notion service and its limiter.
 */
export function notionEffectLayer(client: Client) {
	return Layer.effect(NotionEffect, makeNotionEffect(client)).pipe(
		Layer.provide(rateLimiterLayer),
	);
}

/**
 * Creates a rate-limited Effect wrapper around the Notion SDK client.
 *
 * Every request is limited to three calls per second. Page-returning operations
 * fail unless the API supplies a complete page object with properties.
 *
 * @param client - The Notion SDK client supplied by the workflow context.
 * @returns An Effect that produces the wrapped Notion operations.
 */
const makeNotionEffect = Effect.fn(function* (client: Client) {
	const withRateLimiter = yield* RateLimiter.makeWithRateLimiter;
	const request = <A>(operation: string, run: () => Promise<A>) =>
		Effect.tryPromise({
			try: run,
			catch: (cause) => new NotionRequestError({ operation, cause }),
		}).pipe(
			withRateLimiter({
				key: "notion-api",
				limit: 3,
				window: "1 second",
				onExceeded: "delay",
				algorithm: "token-bucket",
			}),
		);

	const fullPage = (operation: string, page: unknown) => {
		if (isFullPage(page)) {
			return Effect.succeed(page);
		}

		return Effect.fail(new FullPageExpectedError({ operation }));
	};

	return {
		pages: {
			retrieve: (parameters: GetPageParameters) =>
				request("pages.retrieve", () => client.pages.retrieve(parameters)).pipe(
					Effect.flatMap((page) => fullPage("pages.retrieve", page)),
				),
			create: (parameters: CreatePageParameters) =>
				request("pages.create", () => client.pages.create(parameters)).pipe(
					Effect.flatMap((page) => fullPage("pages.create", page)),
				),
			update: (parameters: UpdatePageParameters) =>
				request("pages.update", () => client.pages.update(parameters)).pipe(
					Effect.flatMap((page) => fullPage("pages.update", page)),
				),
		},
		dataSources: {
			queryPages: (parameters: QueryDataSourceParameters) =>
				Effect.gen(function* () {
					const pages: PageObjectResponse[] = [];
					let cursor = parameters.start_cursor;
					do {
						const response = yield* request("dataSources.query", () =>
							client.dataSources.query({
								...parameters,
								result_type: "page",
								page_size: parameters.page_size ?? 100,
								start_cursor: cursor,
							}),
						);
						for (const result of response.results) {
							pages.push(yield* fullPage("dataSources.query", result));
						}
						cursor = response.has_more ? response.next_cursor : null;
					} while (cursor);

					return pages;
				}),
		},
	};
});

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
