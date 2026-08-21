import type { WorkflowContext, WorkflowStepOptions } from "@notionhq/workers/alpha/workflow";
import { Context, Data, Effect, Layer } from "effect";

type StepFunction = WorkflowContext["step"];
type StepResult<A> = A extends void ? null : A;

/** Effect service for executing durable Worker steps. */
export class EffectStep extends Context.Service<EffectStep, ReturnType<typeof makeEffectStep>>()(
	"notion-tasks/EffectStep",
) {}

/**
 * Provides the Effect step service for a workflow invocation.
 *
 * @param step - The step function supplied by the workflow context.
 * @returns A layer containing the Effect step service.
 */
export function effectStepLayer(step: StepFunction) {
	return Layer.succeed(EffectStep, makeEffectStep(step));
}

function makeEffectStep(step: StepFunction) {
	function effectStepRun<A, E>(
		name: string,
		effect: Effect.Effect<A, E>,
	): Effect.Effect<StepResult<A>, WorkflowStepError>;
	function effectStepRun<A, E>(
		name: string,
		options: WorkflowStepOptions,
		effect: Effect.Effect<A, E>,
	): Effect.Effect<StepResult<A>, WorkflowStepError>;
	function effectStepRun<A, E>(
		name: string,
		optionsOrEffect: WorkflowStepOptions | Effect.Effect<A, E>,
		maybeEffect?: Effect.Effect<A, E>,
	): Effect.Effect<StepResult<A>, WorkflowStepError> {
		const options = maybeEffect ? (optionsOrEffect as WorkflowStepOptions) : undefined;
		const effect = maybeEffect ?? (optionsOrEffect as Effect.Effect<A, E>);
		return Effect.tryPromise({
			try: () =>
				options
					? step(name, options, () => Effect.runPromise(effect))
					: step(name, () => Effect.runPromise(effect)),
			catch: (cause) => new WorkflowStepError({ stepName: name, cause }),
		});
	}

	return effectStepRun;
}

class WorkflowStepError extends Data.TaggedError("WorkflowStepError")<{
	readonly stepName: string;
	readonly cause: unknown;
}> {}
