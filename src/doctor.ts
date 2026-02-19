import { execFileSync } from "node:child_process";
import { loadConfig } from "./config/loader.js";
import { ForgeLinearClient } from "./linear/client.js";

export interface DoctorCheck {
	name: string;
	status: "ok" | "warn" | "error";
	message: string;
}

export interface DoctorResult {
	checks: DoctorCheck[];
	ok: boolean;
}

function checkNodeVersion(): DoctorCheck {
	const raw = process.version.replace(/^v/, "");
	const major = Number.parseInt(raw.split(".")[0], 10);
	if (major >= 18) {
		return { name: "Node.js", status: "ok", message: `v${raw}` };
	}
	return {
		name: "Node.js",
		status: "error",
		message: `v${raw} (>= 18 required)`,
	};
}

function checkGit(): DoctorCheck {
	try {
		const out = execFileSync("git", ["--version"], {
			encoding: "utf-8",
			timeout: 5000,
		}).trim();
		return { name: "git", status: "ok", message: out };
	} catch {
		return { name: "git", status: "error", message: "not found" };
	}
}

function checkGhCli(): DoctorCheck {
	try {
		const out = execFileSync("gh", ["--version"], {
			encoding: "utf-8",
			timeout: 5000,
		})
			.trim()
			.split("\n")[0];
		return { name: "gh CLI", status: "ok", message: out };
	} catch {
		return {
			name: "gh CLI",
			status: "warn",
			message: "not found (optional — needed for PR workflows)",
		};
	}
}

function checkLinearApiKey(): DoctorCheck {
	if (process.env.LINEAR_API_KEY) {
		return { name: "LINEAR_API_KEY", status: "ok", message: "set" };
	}
	return {
		name: "LINEAR_API_KEY",
		status: "warn",
		message: "not set (optional — needed for Linear integration)",
	};
}

async function checkLinearApiValid(): Promise<DoctorCheck> {
	const apiKey = process.env.LINEAR_API_KEY;
	if (!apiKey) {
		return { name: "Linear API", status: "warn", message: "skipped (no key)" };
	}
	try {
		const client = new ForgeLinearClient({ apiKey });
		const teams = await client.listTeams();
		if (teams.length > 0) {
			return {
				name: "Linear API",
				status: "ok",
				message: `authenticated (${teams.length} team${teams.length === 1 ? "" : "s"})`,
			};
		}
		return {
			name: "Linear API",
			status: "warn",
			message: "authenticated but no teams visible",
		};
	} catch {
		return {
			name: "Linear API",
			status: "error",
			message: "authentication failed",
		};
	}
}

async function checkLinearTeam(projectDir: string): Promise<DoctorCheck> {
	const apiKey = process.env.LINEAR_API_KEY;
	if (!apiKey) {
		return {
			name: "Linear team",
			status: "warn",
			message: "skipped (no key)",
		};
	}

	let config;
	try {
		config = await loadConfig(projectDir);
	} catch {
		return {
			name: "Linear team",
			status: "warn",
			message: "skipped (could not load config)",
		};
	}

	if (!config.linearTeam) {
		return {
			name: "Linear team",
			status: "warn",
			message: "skipped (no linearTeam in .forge.json)",
		};
	}

	try {
		const client = new ForgeLinearClient({ apiKey });
		const teams = await client.listTeams();
		const match = teams.find(
			(t) => t.key === config.linearTeam || t.name === config.linearTeam,
		);
		if (match) {
			return {
				name: "Linear team",
				status: "ok",
				message: `"${match.name}" (${match.key})`,
			};
		}
		return {
			name: "Linear team",
			status: "error",
			message: `team "${config.linearTeam}" not found`,
		};
	} catch {
		return {
			name: "Linear team",
			status: "error",
			message: "failed to verify team",
		};
	}
}

export async function runDoctor(projectDir: string): Promise<DoctorResult> {
	const checks: DoctorCheck[] = [];

	checks.push(checkNodeVersion());
	checks.push(checkGit());
	checks.push(checkGhCli());
	checks.push(checkLinearApiKey());
	checks.push(await checkLinearApiValid());
	checks.push(await checkLinearTeam(projectDir));

	const ok = checks.every((c) => c.status !== "error");
	return { checks, ok };
}
