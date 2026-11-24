/**
 * Shared stand-ins for the transcript screen tests.
 */
import { createSessionView } from "../src/ui/view/session-screen.ts";
import type { SessionViewDeps } from "../src/ui/view/session-screen.ts";

export function plainTheme() {
	return { fg: (_token: string, text: string) => text, bold: (text: string) => text };
}

export function tagTheme() {
	return { fg: (token: string, text: string) => `‹${token}›${text}`, bold: (text: string) => text };
}

export function user(text: string) {
	return { role: "user", content: text };
}

export function chat(count: number) {
	return Array.from({ length: count }, (_, i) => user(`line ${i + 1}`));
}

export function screen(over: Partial<SessionViewDeps> = {}) {
	let pings = 0;
	let closes = 0;
	const base: SessionViewDeps = {
		title: "✓ worker · cur5e6",
		stats: () => "DONE",
		source: () => [user("Task: map the rust engine")],
		height: () => 12,
		theme: plainTheme() as never,
		empty: "(no transcript saved)",
		render: () => {
			pings += 1;
		},
		onClose: () => {
			closes += 1;
		},
	};
	const view = createSessionView({ ...base, ...over });
	return {
		view,
		pings: () => pings,
		closes: () => closes,
	};
}
