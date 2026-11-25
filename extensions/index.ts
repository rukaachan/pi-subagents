/**
 * pi-subagents: subagents for Pi.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { taskTool } from "../src/tools/task/index.ts";
import { taskOutputTool } from "../src/tools/task-output.ts";
import { taskControlTool } from "../src/tools/task-control.ts";
import { subagentAliasTool } from "../src/tools/subagent-alias.ts";
import { registerSubagentsCommand } from "../src/ui/command.ts";
import { registerDelegateCommand } from "../src/ui/delegate-command.ts";
import { teamEnabled } from "../src/app/team/board/index.ts";
import {
	bindTeamMail,
	clearTeamMail,
	setLeadInbox,
	TEAM_MESSAGE_CUSTOM_TYPE,
} from "../src/app/team/channel/index.ts";
import { HYBRID_POLICY } from "../src/domain/policy/index.ts";
import { TEAM_LEAD_POLICY } from "../src/app/team/run/index.ts";
import { teamMessageTool, teamTool } from "../src/tools/team.ts";
import { beginSession, store, stopPersistence } from "../src/app/session/index.ts";
import { reportStateError } from "../src/app/session/index.ts";
import { stopAllLiveRuns } from "../src/app/stop/index.ts";
import { queuedLegCount, stopLaunchSchedulers } from "../src/app/launch/index.ts";
import { watchEscapeKey } from "../src/app/stop/index.ts";
import { liveCount } from "../src/app/live/index.ts";
import { scopeTasks } from "../src/app/session/index.ts";
import { applyCodemodeWorkerDefault } from "../src/infra/host/index.ts";
import { readGlobalConfig } from "../src/app/session/index.ts";
import { CODEMODE_WORKERS_DEFAULT } from "../src/domain/task/index.ts";
import { footerProgress } from "../src/telemetry/live/index.ts";
import {
	clearNotifySink,
	SETTLED_CUSTOM_TYPE,
	setNotifySink,
} from "../src/telemetry/notify/index.ts";
import { registerSettledCard } from "../src/ui/view/settled-card.ts";

export { restoredCount } from "../src/app/session/index.ts";

export default function (pi: ExtensionAPI) {
	const boot = readGlobalConfig(process.cwd());
	bindTeamMail(store);
	// The host shares two codemode workers with every session in the process.
	applyCodemodeWorkerDefault(boot.liveCap ?? CODEMODE_WORKERS_DEFAULT);
	pi.registerTool(taskTool);
	pi.registerTool(taskOutputTool);
	pi.registerTool(taskControlTool);
	pi.registerTool(teamTool);
	pi.registerTool(teamMessageTool);
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections.pi_subagents_hybrid = HYBRID_POLICY;
		if (teamEnabled()) event.systemPromptOptions.sections.pi_subagents_team = TEAM_LEAD_POLICY;
		else delete event.systemPromptOptions.sections.pi_subagents_team;
	});
	registerSettledCard(pi);
	// The alias is a compatibility shim for models that only know Pi's sample
	// `subagent` tool. It duplicates part of Task's schema, so an operator who
	// does not need it can turn it off with `"alias": false` in settings.
	// Read at load: /reload after changing it.
	if (boot.alias !== false) pi.registerTool(subagentAliasTool);
	let unwatch: (() => void) | null = null;
	let unwatchQueue: (() => void) | null = null;
	pi.on("session_start", (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		clearTeamMail();
		beginSession(ctx.cwd, sessionId, (message) =>
			reportStateError(message, (text) => ctx.ui.notify(`state save failed: ${text}`, "warning")),
		);
		setLeadInbox((text) => {
			pi.sendMessage(
				{ customType: TEAM_MESSAGE_CUSTOM_TYPE, content: text, display: true },
				{ deliverAs: "steer", triggerTurn: true },
			);
		});
		const scope = { cwd: ctx.cwd, sessionId };
		const refreshQueue = () => {
			const waiting = scopeTasks(store.list(), scope).filter(
				(rec) => rec.status === "running" && rec.startedAt === undefined,
			).length;
			footerProgress.setWaiting(waiting + queuedLegCount(sessionId));
		};
		unwatchQueue?.();
		unwatchQueue = store.subscribe(refreshQueue);
		refreshQueue();
		// One sink per session: a leg from an older session must not wake this one.
		setNotifySink((message) => {
			if (readGlobalConfig(ctx.cwd).settleNotify === false) return;
			pi.sendMessage(
				{
					customType: SETTLED_CUSTOM_TYPE,
					content: message.content,
					display: true,
					details: message.details,
				},
				{ deliverAs: "steer", triggerTurn: true },
			);
		}, ctx.sessionManager.getSessionId());
		unwatch?.();
		unwatch = watchEscapeKey(ctx.ui, {
			hasLive: () => liveCount() > 0,
			stopAll: () => {
				stopLaunchSchedulers();
				const summary = stopAllLiveRuns("Esc");
				refreshQueue();
				return summary;
			},
		});
	});
	pi.on("agent_settled", (event) => {
		if (event.aborted) {
			stopLaunchSchedulers();
			stopAllLiveRuns("Esc");
		}
	});
	pi.on("session_shutdown", (event) => {
		clearTeamMail();
		clearNotifySink();
		unwatch?.();
		unwatch = null;
		unwatchQueue?.();
		unwatchQueue = null;
		footerProgress.setWaiting(0);
		if (event.reason === "reload" || event.reason === "quit") {
			stopLaunchSchedulers();
			stopAllLiveRuns(event.reason);
		}
		footerProgress.clearDone();
		stopPersistence();
	});
	registerSubagentsCommand(pi, store);
	registerDelegateCommand(pi, store);
}
