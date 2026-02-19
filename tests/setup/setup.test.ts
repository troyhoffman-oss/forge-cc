import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";

// Mock the Linear client before importing setup
vi.mock("../../src/linear/client.js", () => ({
	ForgeLinearClient: vi.fn(),
}));

import { runSetup } from "../../src/setup.js";

function tempDir() {
	return join(tmpdir(), `forge-setup-test-${randomUUID()}`);
}

describe("setup", () => {
	const dirs: string[] = [];
	const origEnv = { ...process.env };

	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.LINEAR_API_KEY;
	});

	afterEach(async () => {
		process.env = { ...origEnv };
		for (const d of dirs) {
			await rm(d, { recursive: true, force: true });
		}
		dirs.length = 0;
	});

	it("creates .forge.json with valid config", async () => {
		const dir = tempDir();
		dirs.push(dir);
		await mkdir(dir, { recursive: true });

		await runSetup({ projectDir: dir });

		const configContent = await readFile(join(dir, ".forge.json"), "utf-8");
		const config = JSON.parse(configContent);
		expect(config).toHaveProperty("gates");
		expect(config).toHaveProperty("maxIterations", 5);
		expect(config).toHaveProperty("verifyFreshness", 600000);
		expect(Array.isArray(config.gates)).toBe(true);
	});

	it("does not overwrite existing .forge.json", async () => {
		const dir = tempDir();
		dirs.push(dir);
		await mkdir(dir, { recursive: true });

		const existingConfig = { gates: ["custom"], maxIterations: 10 };
		await writeFile(
			join(dir, ".forge.json"),
			JSON.stringify(existingConfig),
			"utf-8",
		);

		await runSetup({ projectDir: dir });

		const configContent = await readFile(join(dir, ".forge.json"), "utf-8");
		const config = JSON.parse(configContent);
		expect(config.maxIterations).toBe(10);
		expect(config.gates).toEqual(["custom"]);
	});

	it("copies pre-commit hook to .forge/hooks/", async () => {
		const dir = tempDir();
		dirs.push(dir);
		await mkdir(dir, { recursive: true });

		await runSetup({ projectDir: dir });

		const hookPath = join(dir, ".forge", "hooks", "pre-commit-verify.js");
		const hookContent = await readFile(hookPath, "utf-8");
		expect(hookContent.length).toBeGreaterThan(0);
	});

	it("adds forge section to CLAUDE.md", async () => {
		const dir = tempDir();
		dirs.push(dir);
		await mkdir(dir, { recursive: true });

		await runSetup({ projectDir: dir });

		const content = await readFile(join(dir, "CLAUDE.md"), "utf-8");
		expect(content).toContain("## Forge Quick Reference");
		expect(content).toContain("npx forge verify");
	});

	it("does not duplicate forge section in existing CLAUDE.md", async () => {
		const dir = tempDir();
		dirs.push(dir);
		await mkdir(dir, { recursive: true });

		// Create CLAUDE.md with existing forge content
		await writeFile(
			join(dir, "CLAUDE.md"),
			"# My Project\n\n## Forge Quick Reference\n\nExisting content.\n",
			"utf-8",
		);

		await runSetup({ projectDir: dir });

		const content = await readFile(join(dir, "CLAUDE.md"), "utf-8");
		const matches = content.match(/## Forge Quick Reference/g);
		expect(matches).toHaveLength(1);
	});

	it("skillsOnly mode skips config, hook, and CLAUDE.md", async () => {
		const dir = tempDir();
		dirs.push(dir);
		await mkdir(dir, { recursive: true });

		await runSetup({ projectDir: dir, skillsOnly: true });

		// .forge.json should NOT be created
		try {
			await readFile(join(dir, ".forge.json"), "utf-8");
			expect.fail(".forge.json should not exist in skillsOnly mode");
		} catch (err: unknown) {
			expect((err as NodeJS.ErrnoException).code).toBe("ENOENT");
		}

		// CLAUDE.md should NOT be created
		try {
			await readFile(join(dir, "CLAUDE.md"), "utf-8");
			expect.fail("CLAUDE.md should not exist in skillsOnly mode");
		} catch (err: unknown) {
			expect((err as NodeJS.ErrnoException).code).toBe("ENOENT");
		}
	});

	it("auto-detects gates from package.json", async () => {
		const dir = tempDir();
		dirs.push(dir);
		await mkdir(dir, { recursive: true });

		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({
				devDependencies: {
					typescript: "^5.0.0",
					biome: "^1.0.0",
				},
			}),
			"utf-8",
		);

		await runSetup({ projectDir: dir });

		const configContent = await readFile(join(dir, ".forge.json"), "utf-8");
		const config = JSON.parse(configContent);
		expect(config.gates).toContain("types");
		expect(config.gates).toContain("lint");
	});
});
