import { createSessionRuntime, type SessionRuntime } from "../src/app/index.ts";
import { hostChild } from "../src/infra/host/index.ts";
import { fileState } from "../src/infra/state/index.ts";

export function testRuntime(): SessionRuntime {
	return createSessionRuntime({ child: hostChild, state: fileState });
}
