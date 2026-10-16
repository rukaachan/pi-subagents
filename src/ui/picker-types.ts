/**
 * pi-subagents: what a picker takes and returns.
 */

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export interface PickItem {
	value: string;
	label: string;
	description?: string;
	fit?: string;
}

export interface PickOptions {
	title: string;
	subtitle?: string;
	body?: string[];
	items: PickItem[];
	maxVisible?: number;
	index?: number;
}

// The two UI methods the picker uses.
export interface PickHost {
	ui: Pick<ExtensionUIContext, "custom" | "select">;
}
