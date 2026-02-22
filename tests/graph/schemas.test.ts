import { describe, it, expect } from "vitest";
import {
  requirementFrontmatterSchema,
  requirementMetaSchema,
  groupDefSchema,
  graphIndexSchema,
} from "../../src/graph/schemas.js";

describe("graph schemas", () => {
  describe("requirementFrontmatterSchema", () => {
    const validFrontmatter = {
      id: "REQ-001",
      title: "Add login page",
      dependsOn: ["REQ-000"],
      files: { creates: ["src/login.ts"], modifies: ["src/app.ts"] },
      acceptance: ["User can log in with valid credentials"],
    };

    it("validates valid requirement frontmatter", () => {
      expect(() => requirementFrontmatterSchema.parse(validFrontmatter)).not.toThrow();
    });

    it("dependsOn is optional", () => {
      const { dependsOn: _, ...withoutDependsOn } = validFrontmatter;
      const result = requirementFrontmatterSchema.parse(withoutDependsOn);
      expect(result.dependsOn).toBeUndefined();
    });

    it("rejects missing id", () => {
      const { id: _, ...noId } = validFrontmatter;
      expect(() => requirementFrontmatterSchema.parse(noId)).toThrow();
    });

    it("rejects missing acceptance", () => {
      const { acceptance: _, ...noAcceptance } = validFrontmatter;
      expect(() => requirementFrontmatterSchema.parse(noAcceptance)).toThrow();
    });

    it("rejects empty acceptance array", () => {
      expect(() =>
        requirementFrontmatterSchema.parse({ ...validFrontmatter, acceptance: [] }),
      ).toThrow();
    });

    it("defaults files to empty arrays when omitted", () => {
      const { files: _, ...noFiles } = validFrontmatter;
      const result = requirementFrontmatterSchema.parse(noFiles);
      expect(result.files).toEqual({ creates: [], modifies: [] });
    });
  });

  describe("graphIndexSchema", () => {
    const validIndex = {
      project: "My Project",
      slug: "my-project",
      branch: "feat/my-project",
      createdAt: "2026-01-01T00:00:00.000Z",
      groups: {
        foundation: {
          name: "Foundation",
          order: 1,
          dependsOn: [],
        },
      },
      requirements: {
        "REQ-001": {
          group: "foundation",
          status: "pending",
          dependsOn: [],
          priority: 1,
        },
      },
    };

    it("validates valid graph index", () => {
      expect(() => graphIndexSchema.parse(validIndex)).not.toThrow();
    });

    it("rejects missing project", () => {
      const { project: _, ...noProject } = validIndex;
      expect(() => graphIndexSchema.parse(noProject)).toThrow();
    });

    it("rejects missing slug", () => {
      const { slug: _, ...noSlug } = validIndex;
      expect(() => graphIndexSchema.parse(noSlug)).toThrow();
    });

    it("rejects missing branch", () => {
      const { branch: _, ...noBranch } = validIndex;
      expect(() => graphIndexSchema.parse(noBranch)).toThrow();
    });
  });

  describe("requirementMetaSchema", () => {
    const validMeta = {
      group: "foundation",
      status: "pending" as const,
      dependsOn: [],
      priority: 1,
    };

    it("rejects invalid requirement status enum", () => {
      expect(() =>
        requirementMetaSchema.parse({ ...validMeta, status: "invalid_status" }),
      ).toThrow();
    });

    it("defaults priority to 0 when omitted", () => {
      const { priority: _, ...noPriority } = validMeta;
      const result = requirementMetaSchema.parse(noPriority);
      expect(result.priority).toBe(0);
    });
  });

  describe("groupDefSchema", () => {
    const validGroup = {
      name: "Foundation",
      order: 1,
      dependsOn: [],
    };

    it("validates valid group definition", () => {
      expect(() => groupDefSchema.parse(validGroup)).not.toThrow();
    });

    it("order is optional", () => {
      const { order: _, ...noOrder } = validGroup;
      const result = groupDefSchema.parse(noOrder);
      expect(result.order).toBeUndefined();
    });

    it("order must be positive integer when present", () => {
      expect(() => groupDefSchema.parse({ ...validGroup, order: 0 })).toThrow();
      expect(() => groupDefSchema.parse({ ...validGroup, order: -1 })).toThrow();
      expect(() => groupDefSchema.parse({ ...validGroup, order: 1.5 })).toThrow();
    });
  });
});
