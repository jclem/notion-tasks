import { Data, Effect } from "effect";

export type TaskConfig = {
	readonly tasksDataSourceId: string;
	readonly templatesDataSourceId: string;
};

/** Reads the two data source IDs used to route task and template events. */
export const readTaskConfig: Effect.Effect<TaskConfig, MissingTaskConfigurationError> = Effect.gen(
	function* () {
		const tasksDataSourceId = yield* requiredEnvironmentVariable("TASKS_DATA_SOURCE_ID");
		const templatesDataSourceId = yield* requiredEnvironmentVariable(
			"TASK_TEMPLATES_DATA_SOURCE_ID",
		);
		return { tasksDataSourceId, templatesDataSourceId };
	},
);

function requiredEnvironmentVariable(name: string) {
	return Effect.sync(() => process.env[name]?.trim()).pipe(
		Effect.filterOrFail(
			(value): value is string => Boolean(value),
			() => new MissingTaskConfigurationError({ name }),
		),
	);
}

export class MissingTaskConfigurationError extends Data.TaggedError(
	"MissingTaskConfigurationError",
)<{
	readonly name: string;
}> {}
