/**
 * pi-subagents: the TeamMessage tool schema.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const PARAMETERS = Type.Object({
	action: StringEnum(["send", "wait"], {
		description: "Send a message to a teammate, or wait for a named run to settle.",
	}),
	to: Type.Optional(Type.String({ description: "Member name, or lead." })),
	text: Type.Optional(
		Type.String({ description: "Message text; capped at 2000 characters (send)." }),
	),
	timeout_ms: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 120_000,
			description: "How long to wait; default 120000 (wait).",
		}),
	),
});

type Params = {
	action: "send" | "wait";
	to?: string;
	text?: string;
	timeout_ms?: number;
};

export { PARAMETERS };
export type { Params };
