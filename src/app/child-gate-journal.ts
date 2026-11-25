/**
 * pi-subagents: wiring a child's gate blocks to the journal.
 */

import type { ChildExtras } from "../infra/host/index.ts";
import type { GateBlock } from "../infra/guard/index.ts";
import { journalWrite } from "../telemetry/journal.ts";

/** Add the gate's journal sink to whatever extras a run already has. */
export function withGateJournal(extras?: ChildExtras): ChildExtras {
	return {
		...extras,
		onGateBlock: (block: GateBlock) =>
			journalWrite({ event: "gate", tool: block.tool, reason: block.reason }),
	};
}
