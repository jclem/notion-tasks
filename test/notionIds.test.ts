import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Option } from "effect";
import { pageIdFromUrl } from "../src/lib/notionIds.js";

describe("pageIdFromUrl", () => {
	it("extracts a compact ID from a titled Notion URL", () => {
		const result = pageIdFromUrl(
			"https://www.notion.so/Pay-credit-card-0123456789abcdef0123456789abcdef",
		);
		assert(Option.isSome(result));
		assert.equal(result.value, "01234567-89ab-cdef-0123-456789abcdef");
	});

	it("preserves a dashed UUID", () => {
		const result = pageIdFromUrl("https://www.notion.so/01234567-89ab-cdef-0123-456789abcdef");
		assert(Option.isSome(result));
		assert.equal(result.value, "01234567-89ab-cdef-0123-456789abcdef");
	});

	it("rejects a missing URL", () => {
		assert(Option.isNone(pageIdFromUrl(null)));
	});
});
