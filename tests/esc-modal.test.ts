/**
 * Esc inside a dialog cancels the dialog, nothing more.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickFromList } from "../src/ui/picker.ts";
import type { PickHost } from "../src/ui/picker-types.ts";
import { watchEscapeKey } from "../src/app/esc-watch.ts";
import { inModal, isModalOpen, modalDepth } from "../src/app/modal-depth.ts";

const ESC = "\x1b";

/** A host whose dialog stays open until the test closes it. */
function heldHost(): PickHost & {
	press: (data: string) => void;
	shown: Promise<void>;
	calls: string[];
} {
	let open: { press(data: string): void } | undefined;
	const gate: { show?: () => void } = {};
	const shown = new Promise<void>((resolve) => {
		gate.show = resolve;
	});
	const calls: string[] = [];
	const ui = {
		custom: async <T>(
			factory: (
				tui: { requestRender(): void },
				theme: never,
				kb: never,
				done: (r: T) => void,
			) => { render(width: number): string[]; handleInput?(d: string): void },
		): Promise<T> => {
			calls.push("custom");
			return new Promise<T>((resolve) => {
				const component = factory(
					{ requestRender: () => {} },
					{ fg: (_c: string, s: string) => s, bold: (s: string) => s } as never,
					null as never,
					resolve,
				);
				open = { press: (data) => component.handleInput?.(data) };
				gate.show?.();
			});
		},
	} as unknown as PickHost["ui"];
	return {
		ui,
		calls,
		shown,
		press: (data) => {
			assert.ok(open, "no dialog is open");
			open.press(data);
		},
	};
}

function watcherUi() {
	const handlers: Array<(data: string) => { consume?: boolean; data?: string } | undefined> = [];
	const notes: string[] = [];
	return {
		notes,
		fire: (data: string) => handlers[0]?.(data),
		port: {
			onTerminalInput(handler: (typeof handlers)[number]) {
				handlers.push(handler);
				return () => {
					const at = handlers.indexOf(handler);
					if (at >= 0) handlers.splice(at, 1);
				};
			},
			notify(message: string) {
				notes.push(message);
			},
		},
	};
}

describe("Esc in a dialog", () => {
	it("closes the dialog and leaves the runs alone", async () => {
		const ui = watcherUi();
		const stops: string[] = [];
		watchEscapeKey(ui.port, {
			hasLive: () => true,
			stopAll: () => {
				stops.push("stop");
				return "Stopped 3 subagents (Esc): worker ×3.";
			},
		});

		const host = heldHost();
		const pending = pickFromList(host, {
			title: "Live runs (3)",
			items: [{ value: "a", label: "worker", description: "running" }],
		});
		await host.shown;
		assert.equal(isModalOpen(), true);

		ui.fire(ESC);
		host.press(ESC);
		assert.equal(await pending, undefined, "the dialog cancelled");
		assert.deepEqual(stops, [], "no run was stopped");
		assert.deepEqual(ui.notes, []);

		ui.fire(ESC);
		assert.deepEqual(stops, ["stop"]);
		assert.deepEqual(ui.notes, ["Stopped 3 subagents (Esc): worker ×3."]);
	});

	it("covers a plain input dialog too", async () => {
		const ui = watcherUi();
		const stops: string[] = [];
		watchEscapeKey(ui.port, {
			hasLive: () => true,
			stopAll: () => {
				stops.push("stop");
				return "";
			},
		});
		await inModal(async () => {
			ui.fire(ESC);
			ui.fire(ESC);
		});
		assert.deepEqual(stops, [], "a prompt owns Esc while it is open");
		ui.fire(ESC);
		assert.deepEqual(stops, ["stop"]);
	});

	it("counts nested dialogs, and a failed one leaves nothing stuck", async () => {
		await inModal(async () => {
			assert.equal(modalDepth(), 1);
			await inModal(async () => {
				assert.equal(modalDepth(), 2);
			});
			assert.equal(modalDepth(), 1);
			await assert.rejects(async () =>
				inModal(async () => {
					throw new Error("dialog blew up");
				}),
			);
			assert.equal(modalDepth(), 1, "the failed dialog released its count");
		});
		assert.equal(modalDepth(), 0);
		assert.equal(isModalOpen(), false);
	});
});
