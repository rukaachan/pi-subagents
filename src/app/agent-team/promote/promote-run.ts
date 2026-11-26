/**
 * pi-subagents: preview or write a starter draft from a finished task.
 */

import { buildPromoteDraft } from "../../../domain/agent-team/lifecycle/index.ts";
import { writeSubagentDraft } from "../../../infra/files/index.ts";
import { journalWrite } from "../../../telemetry/journal/index.ts";
import type { AgentTeamPromoteResult } from "../../../infra/agent-team/tools/index.ts";
import { agentTeamBoard, getTask } from "../board/index.ts";

function fail(taskId: string, error: string): AgentTeamPromoteResult {
	journalWrite({
		event: "agent_team_promote",
		taskId,
		ok: false,
		written: false,
		error: error.slice(0, 200),
	});
	return { ok: false, error };
}

export function promoteTask(
	taskId: string,
	confirm: boolean,
	agentDir?: string,
): AgentTeamPromoteResult {
	const view = getTask(taskId);
	if (!view) return fail(taskId, `Unknown task "${taskId}".`);
	const built = buildPromoteDraft(view.task, agentTeamBoard());
	if (!built.ok) return fail(taskId, built.error);
	const { name, content } = built.draft;
	if (!confirm) {
		journalWrite({
			event: "agent_team_promote",
			taskId,
			ok: true,
			written: false,
			name,
			chars: content.length,
		});
		return { ok: true, name, content, written: false };
	}
	const written = writeSubagentDraft(name, content, agentDir);
	if (!written.ok) return fail(taskId, written.error);
	journalWrite({
		event: "agent_team_promote",
		taskId,
		ok: true,
		written: true,
		name,
		chars: content.length,
		path: written.path,
	});
	return { ok: true, name, content, written: true, path: written.path };
}
