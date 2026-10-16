/**
 * A tool call made inside a script must not look like a model call.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nestedStep } from "../src/domain/activity-step.ts";
import { activityLine } from "../src/telemetry/activity.ts";
import { footerProgress } from "../src/telemetry/progress.ts";
import { trackSession } from "../src/telemetry/track.ts";

type Listener = (event: {
	type: string;
	toolName?: string;
	args?: unknown;
	toolCallId?: string;
	parentToolCallId?: string;
}) => void;

function fakeSession() {
	const listeners: Listener[] = [];
	return {
		subscribe(listener: Listener): () => void {
			listeners.push(listener);
			return () => {
				const i = listeners.indexOf(listener);
				if (i >= 0) listeners.splice(i, 1);
			};
		},
		emit(event: Parameters<Listener>[0]): void {
			for (const l of listeners) l(event);
		},
	};
}

describe("a call inside a script", () => {
	it("is shown under the script that ran it", () => {
		const step = nestedStep("codemode", "read", "src/domain/task.ts");
		assert.equal(activityLine(step), "codemode · read src/domain/task.ts");
		assert.equal(step.nested, true);
	});

	it("keeps the model call on its own line", () => {
		const session = fakeSession();
		const stop = trackSession(session, "k1", "explorer");
		session.emit({ type: "tool_execution_start", toolName: "codemode", toolCallId: "c1" });
		session.emit({
			type: "tool_execution_start",
			toolName: "read",
			args: { path: "src/domain/task.ts" },
			toolCallId: "c1/1",
			parentToolCallId: "c1",
		});
		const steps = footerProgress.recent("k1");
		const last = steps[steps.length - 1];
		assert.ok(last, "the run recorded a step");
		assert.equal(last.tool, "codemode", "the step names the script");
		assert.equal(last.detail, "read src/domain/task.ts", "and the call inside it");
		stop();
	});

	it("keeps a direct call as it was", () => {
		const session = fakeSession();
		const stop = trackSession(session, "k2", "explorer");
		session.emit({
			type: "tool_execution_start",
			toolName: "read",
			args: { path: "src/domain/task.ts" },
			toolCallId: "r1",
		});
		const steps = footerProgress.recent("k2");
		const last = steps[steps.length - 1];
		assert.ok(last, "the run recorded a step");
		assert.equal(last.tool, "read", "a model call keeps its own name");
		assert.equal(last.nested, undefined);
		stop();
	});

	it("names no script when the parent is unknown", () => {
		const session = fakeSession();
		const stop = trackSession(session, "k3", "explorer");
		session.emit({
			type: "tool_execution_start",
			toolName: "read",
			args: { path: "src/x.ts" },
			toolCallId: "r2",
			parentToolCallId: "unknown-parent",
		});
		const steps = footerProgress.recent("k3");
		const last = steps[steps.length - 1];
		assert.ok(last, "the run recorded a step");
		assert.equal(last.tool, "script", "an unknown parent is a plain script");
		stop();
	});
});
