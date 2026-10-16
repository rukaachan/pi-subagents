/**
 * pi-subagents: subagents for Pi.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { taskTool } from "../src/tools/task/index.ts";
import { taskOutputTool } from "../src/tools/task-output.ts";
import { subagentAliasTool } from "../src/tools/subagent-alias.ts";
import { registerSubagentsCommand } from "../src/ui/command.ts";
import { store, stopPersistence } from "../src/app/live-store.ts";
import { stopAllLiveRuns } from "../src/app/stop-all.ts";
import { watchEscapeKey } from "../src/app/esc-watch.ts";
import { liveCount } from "../src/app/live-runs.ts";
import { applyCodemodeWorkerDefault } from "../src/infra/worker-pool.ts";

export { restoredCount } from "../src/app/live-store.ts";

export default function (pi: ExtensionAPI) {
	// The host shares two codemode workers with every session in the process.
	applyCodemodeWorkerDefault();
	pi.registerTool(taskTool);
	pi.registerTool(taskOutputTool);
	pi.registerTool(subagentAliasTool);
	let unwatch: (() => void) | null = null;
	pi.on("session_start", (_event, ctx) => {
		unwatch?.();
		unwatch = watchEscapeKey(ctx.ui, {
			hasLive: () => liveCount() > 0,
			stopAll: () => stopAllLiveRuns("Esc"),
		});
	});
	pi.on("agent_settled", (event) => {
		if (event.aborted) stopAllLiveRuns("Esc");
	});
	pi.on("session_shutdown", (event) => {
		unwatch?.();
		unwatch = null;
		if (event.reason === "reload" || event.reason === "quit") stopAllLiveRuns(event.reason);
		stopPersistence();
	});
	registerSubagentsCommand(pi, store);
}
