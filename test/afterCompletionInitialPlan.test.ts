import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PageObjectResponse } from "@notionhq/client";
import { afterCompletionInitialPlan } from "../src/lib/templateRecurrence.js";

describe("afterCompletionInitialPlan", () => {
	it("creates an initial task when the template has no instances", () => {
		assert.deepEqual(afterCompletionInitialPlan([], "template-1"), {
			occurrenceKey: "initial:template-1",
			create: true,
			duplicateIds: [],
		});
	});

	it("adopts an existing template instance without creating another task", () => {
		assert.deepEqual(afterCompletionInitialPlan([taskPage("task-1", "")], "template-1"), {
			occurrenceKey: "initial:template-1",
			create: false,
			duplicateIds: [],
		});
	});

	it("identifies duplicate initial tasks", () => {
		const plan = afterCompletionInitialPlan(
			[taskPage("task-1", "initial:template-1"), taskPage("task-2", "initial:template-1")],
			"template-1",
		);

		assert.deepEqual(plan, {
			occurrenceKey: "initial:template-1",
			create: false,
			duplicateIds: ["task-2"],
		});
	});
});

function taskPage(id: string, occurrenceKey: string) {
	return {
		id,
		properties: {
			"Occurrence Key": {
				id: "occurrence-key",
				type: "rich_text",
				rich_text: occurrenceKey.length === 0 ? [] : [{ plain_text: occurrenceKey }],
			},
		},
	} as unknown as PageObjectResponse;
}
