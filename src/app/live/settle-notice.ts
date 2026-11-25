/**
 * pi-subagents: tell the parent that a background leg settled.
 */

import { notifySettled } from "../../telemetry/notify/index.ts";
import { sweepMemberTasks } from "../team/board/index.ts";
import { capDelivery } from "../../domain/run/index.ts";
import type { TaskRecord } from "../../domain/task/index.ts";

/**
 * Send the one notice for a finished background run. The report rides along
 * unless TaskOutput already delivered it. Returns whether the sink took it.
 */
export function announceSettle(
	rec: TaskRecord,
	parentSessionId: string,
	teamKey = rec.taskId,
): boolean {
	const usage = rec.result?.usage;
	const sweep = sweepMemberTasks(teamKey, rec.status === "done", Date.now(), rec.error);
	const report =
		rec.status === "done" && !rec.fullDelivered && rec.result
			? capDelivery(rec.result.text)
			: undefined;
	const wasDelivered = rec.fullDelivered;
	if (report !== undefined) rec.fullDelivered = true;
	const sent = notifySettled({
		taskId: rec.taskId,
		subagent: rec.subagentName,
		status: rec.status === "done" ? "done" : "error",
		elapsedMs: Date.now() - rec.createdAt,
		turns: usage?.turns ?? 0,
		tokens: usage ? usage.input + usage.output : 0,
		cost: usage?.cost,
		model: rec.result?.model ?? rec.modelId,
		report,
		error: rec.status === "error" ? rec.error : undefined,
		parentSessionId,
		delivered: report !== undefined,
		...(sweep.released.length || sweep.open.length ? { team: sweep } : {}),
	});
	if (!sent) rec.fullDelivered = wasDelivered;
	return sent;
}
