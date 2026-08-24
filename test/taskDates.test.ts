import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PageObjectResponse } from "@notionhq/client";
import { recurrencePlan } from "../src/lib/recurrencePlan.js";
import { parseTaskTemplate, scheduledTaskDates } from "../src/lib/taskTemplate.js";

describe("scheduledTaskDates", () => {
	it("supports a Start date without a Due date", () => {
		assert.deepEqual(scheduledTaskDates({ dueOffsetDays: null }, "2026-09-20"), {
			start: "2026-09-20",
			due: null,
		});
	});

	it("sets Start and Due to the occurrence date for a zero offset", () => {
		assert.deepEqual(scheduledTaskDates({ dueOffsetDays: 0 }, "2026-09-20"), {
			start: "2026-09-20",
			due: "2026-09-20",
		});
	});

	it("sets Due a calendar-day offset after Start", () => {
		assert.deepEqual(scheduledTaskDates({ dueOffsetDays: 14 }, "2026-09-20"), {
			start: "2026-09-20",
			due: "2026-10-04",
		});
	});
});

describe("parseTaskTemplate date placement", () => {
	it("accepts an empty Due offset", () => {
		const parsed = parseTaskTemplate(templatePage(null));
		assert(parsed.ok);
		assert.equal(parsed.template.dueOffsetDays, null);
	});

	it("accepts a whole-day Due offset", () => {
		const parsed = parseTaskTemplate(templatePage(14));
		assert(parsed.ok);
		assert.equal(parsed.template.dueOffsetDays, 14);
	});

	it("rejects fractional offsets", () => {
		const parsed = parseTaskTemplate(templatePage(1.5));
		assert(!parsed.ok);
		assert.match(parsed.message, /whole number/);
	});

	it("rejects negative offsets", () => {
		const parsed = parseTaskTemplate(templatePage(-1));
		assert(!parsed.ok);
		assert.match(parsed.message, /non-negative/);
	});

	it("rejects a Starts value with a time", () => {
		const page = templatePage(null);
		page.properties.Starts = {
			id: "starts",
			type: "date",
			date: { start: "2026-09-20T09:00:00.000-04:00" },
		} as PageObjectResponse["properties"][string];
		const parsed = parseTaskTemplate(page);
		assert(!parsed.ok);
		assert.match(parsed.message, /without a time/);
	});
});

describe("recurrencePlan date placement", () => {
	it("reuses a future Due occurrence when migrating a template to Start", () => {
		const existing = taskPage("task-1", null, "2026-09-20");
		const plan = recurrencePlan([existing], ["2026-09-20"], "2026-08-23", "Start", "Due");

		assert.deepEqual(plan.synchronize, [
			{ occurrence: existing, occurrenceDate: "2026-09-20" },
		]);
		assert.deepEqual(plan.create, []);
	});
});

function templatePage(dueOffsetDays: number | null) {
	return {
		id: "template-1",
		properties: {
			Name: { id: "title", type: "title", title: [{ plain_text: "Example" }] },
			Enabled: { id: "enabled", type: "checkbox", checkbox: true },
			"Repeat Mode": {
				id: "mode",
				type: "select",
				select: { name: "Regularly" },
			},
			Starts: { id: "starts", type: "date", date: { start: "2026-09-20" } },
			Schedule: {
				id: "schedule",
				type: "rich_text",
				rich_text: [{ plain_text: "Monthly" }],
			},
			"Due Offset Days": {
				id: "due-offset-days",
				type: "number",
				number: dueOffsetDays,
			},
			Notes: { id: "notes", type: "rich_text", rich_text: [] },
			Context: { id: "context", type: "relation", relation: [] },
		},
	} as unknown as PageObjectResponse;
}

function taskPage(id: string, start: string | null, due: string | null) {
	return {
		id,
		properties: {
			Start: { id: "start", type: "date", date: start === null ? null : { start } },
			Due: { id: "due", type: "date", date: due === null ? null : { start: due } },
		},
	} as unknown as PageObjectResponse;
}
