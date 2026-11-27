/**
 * pi-subagents: list pickers that do not wrap.
 */

import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Key, Spacer, Text, matchesKey } from "@earendil-works/pi-tui";
import { KEY_DOWN, KEY_UP, buildPicker, fitDescriptions, titleBlock } from "./picker-render.ts";
import { fitHint } from "./view/design/index.ts";
import { inModal } from "../app/stop/index.ts";
import type { PickHost, PickItem, PickOptions } from "./picker-types.ts";

export type { PickHost, PickItem, PickOptions };

export async function pickFromList(host: PickHost, opts: PickOptions): Promise<string | undefined> {
	if (opts.items.length === 0) return undefined;

	if (typeof host.ui.custom === "function") {
		try {
			const custom = host.ui.custom as NonNullable<typeof host.ui.custom>;
			// A dialog owns Esc: the Esc watcher must not read the same
			// press as "stop every live run".
			const chosen = await inModal(() =>
				custom<string | undefined>((tui, theme, _kb, done) => {
					const wrap = new Container();
					const head = titleBlock(opts.title, opts.subtitle, opts.body, theme);
					wrap.addChild(head.node);
					wrap.addChild(new Spacer(1));
					const { list } = buildPicker(opts.items, theme, {
						maxVisible: opts.maxVisible,
						index: opts.index,
					});
					wrap.addChild(list);
					wrap.addChild(new Spacer(1));
					const hint = new Text("", 0, 0);
					wrap.addChild(hint);
					list.onSelect = (item) => done(item.value);
					list.onCancel = () => done(undefined);

					return {
						render: (width: number) => {
							fitDescriptions(opts.items, width);
							head.fit(width);
							hint.setText(fitHint("↑↓ move   enter select   esc cancel", width, theme));
							return wrap.render(width);
						},
						invalidate: () => wrap.invalidate(),
						handleInput: (data: string) => {
							if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
								done(undefined);
								return;
							}
							// SelectList handles arrows only; add the vim keys Pi uses.
							if (data === "j") list.handleInput(KEY_DOWN);
							else if (data === "k") list.handleInput(KEY_UP);
							else list.handleInput(data);
							tui.requestRender();
						},
					};
				}),
			);
			if (chosen !== undefined) return chosen;
			// The custom screen ran and was cancelled: that cancel is
			// final. Falling through to host.ui.select would re-prompt
			// with a second bare list that eats another Esc.
			return undefined;
		} catch {
			/* custom() failed; use the plain selector */
		}
	}

	if (typeof host.ui.select === "function") {
		const labels = opts.items.map((i) => i.label);
		const picked = await inModal(() => host.ui.select(opts.title, labels));
		if (picked === undefined) return undefined;
		const idx = labels.indexOf(picked);
		const item = idx >= 0 ? opts.items[idx] : undefined;
		return item ? item.value : picked;
	}
	return undefined;
}

export async function pickAction(
	ctx: ExtensionContext | ExtensionCommandContext,
	title: string,
	actions: string[],
	subtitle?: string,
): Promise<string | undefined> {
	return pickFromList(ctx as PickHost, {
		title,
		subtitle,
		items: actions.map((a) => ({ value: a, label: a })),
	});
}

export async function pickChoice(
	ctx: ExtensionContext | ExtensionCommandContext,
	title: string,
	choices: string[],
	current?: string,
): Promise<string | undefined> {
	return pickFromList(ctx as PickHost, {
		title,
		items: choices.map((c) => ({
			value: c,
			label: c,
			description: c === current ? "(current)" : undefined,
		})),
	});
}
