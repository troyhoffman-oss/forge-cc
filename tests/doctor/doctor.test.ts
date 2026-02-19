import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";

// Mock child_process before importing doctor
vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));

// Mock the Linear client
vi.mock("../../src/linear/client.js", () => ({
	ForgeLinearClient: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { ForgeLinearClient } from "../../src/linear/client.js";
import { runDoctor } from "../../src/doctor.js";
import type { DoctorResult, DoctorCheck } from "../../src/doctor.js";

const mockedExecFileSync = vi.mocked(execFileSync);
const MockedForgeLinearClient = vi.mocked(ForgeLinearClient);

function tempDir() {
	return join(tmpdir(), `forge-doctor-test-${randomUUID()}`);
}

describe("doctor", () => {
	const dirs: string[] = [];
	const origEnv = { ...process.env };

	beforeEach(() => {
		vi.clearAllMocks();
		// Default: git and gh succeed
		mockedExecFileSync.mockImplementation((cmd: string) => {
			if (cmd === "git") return "git version 2.43.0\n";
			if (cmd === "gh") return "gh version 2.40.0 (2024-01-01)\n";
			return "";
		});
		// Default: no LINEAR_API_KEY
		delete process.env.LINEAR_API_KEY;
	});

	afterEach(async () => {
		process.env = { ...origEnv };
		for (const d of dirs) {
			await rm(d, { recursive: true, force: true });
		}
		dirs.length = 0;
	});

	it("returns structured DoctorResult with all checks", async () => {
		const dir = tempDir();
		await mkdir(dir, { recursive: true });
		dirs.push(dir);

		const result = await runDoctor(dir);

		expect(result).toHaveProperty("checks");
		expect(result).toHaveProperty("ok");
		expect(Array.isArray(result.checks)).toBe(true);
		expect(result.checks.length).toBe(6);

		for (const check of result.checks) {
			expect(check).toHaveProperty("name");
			expect(check).toHaveProperty("status");
			expect(check).toHaveProperty("message");
			expect(["ok", "warn", "error"]).toContain(check.status);
		}
	});

	it("reports ok when all dependencies are present", async () => {
		const dir = tempDir();
		await mkdir(dir, { recursive: true });
		dirs.push(dir);

		const result = await runDoctor(dir);

		expect(result.ok).toBe(true);
		const nodeCheck = result.checks.find((c) => c.name === "Node.js");
		expect(nodeCheck?.status).toBe("ok");

		const gitCheck = result.checks.find((c) => c.name === "git");
		expect(gitCheck?.status).toBe("ok");
	});

	it("reports error when git is missing", async () => {
		const dir = tempDir();
		await mkdir(dir, { recursive: true });
		dirs.push(dir);

		mockedExecFileSync.mockImplementation((cmd: string) => {
			if (cmd === "git") throw new Error("not found");
			if (cmd === "gh") return "gh version 2.40.0\n";
			return "";
		});

		const result = await runDoctor(dir);

		expect(result.ok).toBe(false);
		const gitCheck = result.checks.find((c) => c.name === "git");
		expect(gitCheck?.status).toBe("error");
		expect(gitCheck?.message).toBe("not found");
	});

	it("reports warn (not error) when gh CLI is missing", async () => {
		const dir = tempDir();
		await mkdir(dir, { recursive: true });
		dirs.push(dir);

		mockedExecFileSync.mockImplementation((cmd: string) => {
			if (cmd === "git") return "git version 2.43.0\n";
			if (cmd === "gh") throw new Error("not found");
			return "";
		});

		const result = await runDoctor(dir);

		expect(result.ok).toBe(true);
		const ghCheck = result.checks.find((c) => c.name === "gh CLI");
		expect(ghCheck?.status).toBe("warn");
	});

	it("reports warn when LINEAR_API_KEY is not set", async () => {
		const dir = tempDir();
		await mkdir(dir, { recursive: true });
		dirs.push(dir);

		delete process.env.LINEAR_API_KEY;
		const result = await runDoctor(dir);

		const keyCheck = result.checks.find((c) => c.name === "LINEAR_API_KEY");
		expect(keyCheck?.status).toBe("warn");

		const apiCheck = result.checks.find((c) => c.name === "Linear API");
		expect(apiCheck?.status).toBe("warn");
		expect(apiCheck?.message).toBe("skipped (no key)");
	});

	it("validates Linear API key when set", async () => {
		const dir = tempDir();
		await mkdir(dir, { recursive: true });
		dirs.push(dir);

		process.env.LINEAR_API_KEY = "lin_api_test123";

		const mockListTeams = vi.fn().mockResolvedValue([
			{ id: "t1", name: "Engineering", key: "ENG" },
		]);
		MockedForgeLinearClient.mockImplementation(
			() => ({ listTeams: mockListTeams }) as unknown as ForgeLinearClient,
		);

		const result = await runDoctor(dir);

		const keyCheck = result.checks.find((c) => c.name === "LINEAR_API_KEY");
		expect(keyCheck?.status).toBe("ok");

		const apiCheck = result.checks.find((c) => c.name === "Linear API");
		expect(apiCheck?.status).toBe("ok");
		expect(apiCheck?.message).toContain("authenticated");
	});

	it("finds configured Linear team", async () => {
		const dir = tempDir();
		await mkdir(dir, { recursive: true });
		dirs.push(dir);

		process.env.LINEAR_API_KEY = "lin_api_test123";
		await writeFile(
			join(dir, ".forge.json"),
			JSON.stringify({ linearTeam: "ENG" }),
			"utf-8",
		);

		const mockListTeams = vi.fn().mockResolvedValue([
			{ id: "t1", name: "Engineering", key: "ENG" },
		]);
		MockedForgeLinearClient.mockImplementation(
			() => ({ listTeams: mockListTeams }) as unknown as ForgeLinearClient,
		);

		const result = await runDoctor(dir);

		const teamCheck = result.checks.find((c) => c.name === "Linear team");
		expect(teamCheck?.status).toBe("ok");
		expect(teamCheck?.message).toContain("Engineering");
	});
});
