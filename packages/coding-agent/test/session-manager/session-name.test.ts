import { chmodSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";

const userMsg = (text: string) => ({ role: "user" as const, content: text, timestamp: 1 });

describe("SessionManager session name", () => {
	let tempDir: string;
	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "session-name-"));
	});
	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns the latest session_info name, and an empty name clears it", () => {
		const session = SessionManager.inMemory();
		expect(session.getSessionName()).toBeUndefined();
		session.appendSessionInfo("first");
		session.appendMessage(userMsg("hello"));
		expect(session.getSessionName()).toBe("first");
		session.appendSessionInfo("second");
		expect(session.getSessionName()).toBe("second");
		session.appendSessionInfo("");
		expect(session.getSessionName()).toBeUndefined();
	});

	it("keeps the name of a loaded, branched, or new session", () => {
		const session = SessionManager.create(tempDir, tempDir);
		const firstId = session.appendMessage(userMsg("first question"));
		session.appendSessionInfo("named");
		session.appendMessage(userMsg("second question"));
		const file = session.getSessionFile()!;

		expect(SessionManager.open(file, tempDir).getSessionName()).toBe("named");

		// The branched path ends before the session_info entry, so the new session has no name.
		session.createBranchedSession(firstId);
		expect(session.getSessionName()).toBeUndefined();

		session.newSession();
		expect(session.getSessionName()).toBeUndefined();
	});

	it("keeps the previous name when writing a session_info entry fails", () => {
		const session = SessionManager.create(tempDir, tempDir);
		session.appendMessage(userMsg("first question"));
		session.appendSessionInfo("kept");
		const file = session.getSessionFile()!;

		chmodSync(file, 0o444);
		try {
			expect(() => session.appendSessionInfo("lost")).toThrow();
		} finally {
			chmodSync(file, 0o644);
		}
		expect(session.getSessionName()).toBe("kept");
	});

	// The footer reads the name on every frame. A session named early must not cost a scan of its entries.
	it("reads the name without scanning the entries", () => {
		const session = SessionManager.inMemory();
		session.appendSessionInfo("early");
		for (let i = 0; i < 1000; i++) session.appendMessage(userMsg(`message ${i}`));
		const internal = session as unknown as { fileEntries: unknown[] };
		let reads = 0;
		internal.fileEntries = new Proxy(internal.fileEntries, {
			get(target, key, receiver) {
				if (typeof key === "string" && /^\d+$/.test(key)) reads++;
				return Reflect.get(target, key, receiver);
			},
		});
		expect(session.getSessionName()).toBe("early");
		expect(reads).toBe(0);
	});
});
