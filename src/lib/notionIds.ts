import { Option } from "effect";

/** Extracts and normalizes the trailing Notion page ID from a public page URL. */
export function pageIdFromUrl(url: string | null): Option.Option<string> {
	if (!url) {
		return Option.none();
	}

	const compact = url.match(/([0-9a-f]{32})(?:[?#].*)?$/i)?.[1];
	if (compact) {
		return Option.some(
			`${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`,
		);
	}

	const uuid = url.match(
		/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#].*)?$/i,
	)?.[1];
	return Option.fromNullishOr(uuid);
}
