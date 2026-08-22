import type { WorkflowContext } from "@notionhq/workers/alpha/workflow";
import { NodeServices } from "@effect/platform-node";
import { Layer } from "effect";
import { effectStepLayer } from "./effectStep.js";
import { notionEffectLayer } from "./notionEffect.js";

/**
 * Provides the platform, durable-step, and Notion services for one workflow invocation.
 *
 * @param context - The context supplied to the workflow handler.
 * @returns A layer containing all services required by workflow programs.
 */
export function workflowLayer(context: WorkflowContext) {
	return notionEffectLayer(context.notion).pipe(
		Layer.provideMerge(effectStepLayer(context.step)),
		Layer.merge(NodeServices.layer),
	);
}
