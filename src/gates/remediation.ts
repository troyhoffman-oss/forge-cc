import type { GateError } from "../types.js";

// ---------------------------------------------------------------------------
// TypeScript Error Remediation
// ---------------------------------------------------------------------------

/** Known TS error codes mapped to actionable fix instructions */
const TS_ERROR_MAP: Record<string, string> = {
  // Assignment & type mismatch
  TS2322: "Type is not assignable — change the target type, cast with `as`, or fix the source value.",
  TS2345: "Argument type mismatch — update the argument to match the parameter type or widen the parameter.",
  TS2352: "Conversion may be a mistake — use `unknown` as an intermediate cast if the conversion is intentional.",
  TS2741: "Property is missing in type — add the missing property to the object literal or mark it optional in the interface.",

  // Property access
  TS2339: "Property does not exist on type — add the property to the type definition, use a type assertion, or check for a typo.",
  TS2551: "Property does not exist (did you mean?) — check the suggested spelling correction and fix the property name.",

  // Missing / extra arguments
  TS2554: "Wrong number of arguments — add missing arguments or remove extras to match the function signature.",
  TS2555: "Expected at least N arguments — provide the required arguments to the function call.",
  TS2556: "Spread argument must have a tuple type — type the spread array as a tuple or use individual arguments.",

  // Module / import resolution
  TS2307: "Cannot find module — verify the import path, ensure the file exists, and check that the .js extension is included for ES modules.",
  TS2305: "Module has no exported member — check the export name for typos or update the module's exports.",
  TS2614: "Module has no default export — use a named import instead, or add a default export to the module.",
  TS1259: "Module can only be default-imported with esModuleInterop — enable esModuleInterop in tsconfig or use `import * as` syntax.",

  // Null / undefined safety
  TS2531: "Object is possibly null — add a null check, use optional chaining (?.), or apply the non-null assertion (!) if you are certain.",
  TS2532: "Object is possibly undefined — add an undefined check, use optional chaining (?.), or provide a fallback with ??.",
  TS2533: "Object is possibly null or undefined — guard with a truthiness check or use optional chaining.",
  TS18047: "Value is possibly null — add a null guard before accessing properties.",
  TS18048: "Value is possibly undefined — add an undefined guard before accessing properties.",

  // Declarations & identifiers
  TS2304: "Cannot find name — check for typos, add the missing import, or declare the variable/type.",
  TS2451: "Cannot redeclare block-scoped variable — rename one of the declarations or move it to a different scope.",
  TS2440: "Import declaration conflicts with local value — rename the local variable or the import alias.",

  // Return types & control flow
  TS2355: "Function must return a value — add a return statement for all code paths.",
  TS7030: "Not all code paths return a value — ensure every branch in the function returns or add an explicit return at the end.",
  TS2366: "Function lacks ending return — add a return statement at the end of the function.",

  // Generics & type parameters
  TS2314: "Generic type requires type arguments — provide explicit type parameters (e.g., Array<string>).",
  TS2344: "Type does not satisfy constraint — change the type argument to one that extends the required constraint.",
  TS2558: "Expected type arguments — supply the required generic parameters.",

  // Overloads & signatures
  TS2769: "No overload matches this call — check argument types against all overload signatures and fix the mismatch.",

  // Strict mode
  TS7006: "Parameter implicitly has an 'any' type — add an explicit type annotation to the parameter.",
  TS7031: "Binding element implicitly has an 'any' type — add a type annotation to the destructured parameter.",
  TS7053: "Element implicitly has an 'any' type — add an index signature to the type or use a Map instead.",
};

/** Regex to extract TS error code from a gate error message */
const TS_CODE_RE = /\bTS(\d+)\b/;

/**
 * Build actionable remediation text for a TypeScript compilation error.
 *
 * Parses the TS error code from the message and returns a targeted fix
 * instruction. Falls back to a generic hint when the code is unrecognized.
 */
export function buildTypeRemediation(error: GateError): string {
  const match = TS_CODE_RE.exec(error.message);

  if (match) {
    const code = `TS${match[1]}`;
    const hint = TS_ERROR_MAP[code];
    if (hint) {
      const location = formatLocation(error);
      return `${location}${code}: ${hint}`;
    }
    // Known code pattern but not in our map — still include the code
    const location = formatLocation(error);
    return `${location}${code}: Review the TypeScript documentation for this error code and fix the type mismatch.`;
  }

  // No TS code found — return a generic remediation
  const location = formatLocation(error);
  return `${location}Fix the TypeScript error: ${error.message}`;
}

// ---------------------------------------------------------------------------
// Lint Error Remediation
// ---------------------------------------------------------------------------

/** Common ESLint / Biome rule names mapped to fix instructions */
const LINT_RULE_MAP: Record<string, string> = {
  // Unused code
  "no-unused-vars": "Remove the unused variable or import, or prefix it with _ to indicate intentional non-use.",
  "noUnusedVariables": "Remove the unused variable or import, or prefix it with _ to indicate intentional non-use.",
  "@typescript-eslint/no-unused-vars": "Remove the unused variable or import, or prefix it with _ to indicate intentional non-use.",
  "noUnusedImports": "Remove the unused import statement.",

  // Consistency & style
  "no-console": "Remove the console statement or replace it with a proper logger.",
  "eqeqeq": "Use strict equality (=== / !==) instead of loose equality (== / !=).",
  "prefer-const": "Change `let` to `const` since the variable is never reassigned.",
  "no-var": "Replace `var` with `let` or `const`.",
  "useConst": "Change `let` to `const` since the variable is never reassigned.",

  // Type safety
  "no-explicit-any": "Replace `any` with a specific type or `unknown`.",
  "@typescript-eslint/no-explicit-any": "Replace `any` with a specific type or `unknown`.",
  "noExplicitAny": "Replace `any` with a specific type or `unknown`.",
  "no-non-null-assertion": "Remove the non-null assertion (!) and add a proper null check.",
  "@typescript-eslint/no-non-null-assertion": "Remove the non-null assertion (!) and add a proper null check.",
  "noNonNullAssertion": "Remove the non-null assertion (!) and add a proper null check.",

  // Import rules
  "no-duplicate-imports": "Merge duplicate imports from the same module into a single import statement.",
  "noDuplicateImports": "Merge duplicate imports from the same module into a single import statement.",
  "import/order": "Reorder imports to follow the project convention (builtins, externals, internals).",
  "import/no-unresolved": "Fix the import path — the module cannot be resolved. Check for typos or missing packages.",
  "noUndeclaredDependencies": "Add the dependency to package.json or fix the import path.",

  // Code quality
  "no-shadow": "Rename the inner variable to avoid shadowing the outer declaration.",
  "noShadowRestrictedNames": "Rename the variable — it shadows a restricted global name.",
  "no-redeclare": "Remove the duplicate declaration or rename one of the variables.",
  "no-unreachable": "Remove the unreachable code after the return/throw/break/continue statement.",
  "noUnreachable": "Remove the unreachable code after the return/throw/break/continue statement.",
  "complexity": "Reduce function complexity by extracting logic into smaller helper functions.",
  "useExhaustiveDependencies": "Add the missing dependencies to the hook dependency array, or wrap the value with useCallback/useMemo.",

  // Biome-specific formatting / organization
  "useImportType": "Change to `import type` since this import is only used as a type.",
  "noUnsafeDeclarationMerging": "Avoid declaration merging — rename the interface or class to prevent unsafe overlap.",
  "useOptionalChain": "Use optional chaining (?.) instead of manual null checks.",
  "noParameterAssign": "Do not reassign function parameters — use a local variable instead.",

  // Async / promises
  "no-floating-promises": "Await the promise or explicitly handle it with .catch().",
  "@typescript-eslint/no-floating-promises": "Await the promise or explicitly handle it with .catch().",
  "require-await": "Remove the async keyword if the function does not use await, or add an await expression.",
  "no-return-await": "Remove the redundant `return await` — just return the promise directly.",
  "noAsyncPromiseExecutor": "Do not pass an async function to new Promise() — handle async logic outside the constructor.",
};

/** Regex to extract a lint rule name from a Biome or ESLint error message */
const LINT_RULE_RE = /\b(?:lint\/|@[\w-]+\/)?(?:[\w-]+\/)?(\w[\w-]*)\b/;

/** Regex matching Biome-style rule names like lint/style/useConst */
const BIOME_RULE_RE = /lint\/[\w-]+\/([\w-]+)/;

/**
 * Build actionable remediation text for a lint error (ESLint or Biome).
 *
 * Extracts the rule name from the error message and returns a targeted fix
 * instruction. Falls back to a generic hint when the rule is unrecognized.
 */
export function buildLintRemediation(error: GateError): string {
  const location = formatLocation(error);

  // Try Biome-style rule path first (e.g., lint/style/useConst)
  const biomeMatch = BIOME_RULE_RE.exec(error.message);
  if (biomeMatch) {
    const ruleName = biomeMatch[1];
    const hint = LINT_RULE_MAP[ruleName];
    if (hint) {
      return `${location}[${ruleName}] ${hint}`;
    }
  }

  // Try generic rule name extraction
  const genericMatch = LINT_RULE_RE.exec(error.message);
  if (genericMatch) {
    const ruleName = genericMatch[1];
    const hint = LINT_RULE_MAP[ruleName];
    if (hint) {
      return `${location}[${ruleName}] ${hint}`;
    }
  }

  // Check if any known rule name appears literally in the message
  for (const [rule, hint] of Object.entries(LINT_RULE_MAP)) {
    if (error.message.includes(rule)) {
      return `${location}[${rule}] ${hint}`;
    }
  }

  // Fall back to generic lint remediation
  return `${location}Fix the lint issue: ${error.message}`;
}

// ---------------------------------------------------------------------------
// Test Error Remediation
// ---------------------------------------------------------------------------

/** Patterns in test failure messages mapped to actionable fix instructions */
const TEST_PATTERNS: Array<{
  pattern: RegExp;
  hint: string;
}> = [
  {
    pattern: /Expected.*Received|toBe|toEqual|toStrictEqual/i,
    hint: "Assertion mismatch — compare the expected and received values, then fix the implementation to produce the correct output or update the test expectation.",
  },
  {
    pattern: /AssertionError|AssertionError/i,
    hint: "Assertion failed — review the test's expected vs actual values and fix the underlying code or update the test.",
  },
  {
    pattern: /TypeError:\s*Cannot read propert/i,
    hint: "Runtime TypeError — a value is null or undefined when a property is accessed. Add a null check or ensure proper initialization.",
  },
  {
    pattern: /TypeError:\s*.*is not a function/i,
    hint: "Function call on non-function — check that the import is correct and the value is actually a function.",
  },
  {
    pattern: /ReferenceError/i,
    hint: "Variable is not defined — check for typos, missing imports, or variables used before declaration.",
  },
  {
    pattern: /SyntaxError/i,
    hint: "Syntax error in source or test file — check for missing brackets, invalid syntax, or broken imports.",
  },
  {
    pattern: /timeout|timed?\s*out/i,
    hint: "Test timed out — check for infinite loops, unresolved promises, or missing async/await. Consider increasing the test timeout if the operation is legitimately slow.",
  },
  {
    pattern: /ENOENT|no such file/i,
    hint: "File not found — check that the file path is correct and the file exists. Fixtures or test data may need to be created.",
  },
  {
    pattern: /ECONNREFUSED|ECONNRESET/i,
    hint: "Connection refused — the test expects a server to be running. Check that test setup starts the required service or use a mock.",
  },
  {
    pattern: /snapshot.*mismatch|snapshot.*updated/i,
    hint: "Snapshot mismatch — if the change is intentional, run `npm test -- -u` to update snapshots. Otherwise, fix the component to match the existing snapshot.",
  },
  {
    pattern: /mock.*not.*called|not.*been.*called/i,
    hint: "Mock was not called as expected — verify the code path actually invokes the mocked function. Check that the mock is set up before the code under test runs.",
  },
  {
    pattern: /mock.*called.*times|called.*\d+.*times/i,
    hint: "Mock call count mismatch — the function was called a different number of times than expected. Review the logic to ensure the correct number of invocations.",
  },
];

/**
 * Build actionable remediation text for a test failure.
 *
 * Scans the error message for common failure patterns (assertion mismatches,
 * runtime errors, timeouts) and returns targeted fix instructions. Falls
 * back to a generic test-fix hint when no patterns match.
 */
export function buildTestRemediation(error: GateError): string {
  const location = formatLocation(error);

  for (const { pattern, hint } of TEST_PATTERNS) {
    if (pattern.test(error.message)) {
      return `${location}${hint}`;
    }
  }

  // Fallback for FAIL lines and generic test errors
  if (/FAIL/i.test(error.message)) {
    return `${location}Test suite failed — open the test file, review failing assertions, and fix the underlying code or update the test expectations.`;
  }

  return `${location}Test failure — open the failing test file, review the error details, and fix the implementation or update the test expectation.`;
}

// ---------------------------------------------------------------------------
// Visual Error Remediation
// ---------------------------------------------------------------------------

/** Keywords in visual error messages mapped to CSS/layout fix hints */
const VISUAL_PATTERNS: Array<{
  pattern: RegExp;
  hint: (match: RegExpMatchArray, error: GateError) => string;
}> = [
  {
    pattern: /overflow/i,
    hint: (_m, _e) =>
      "Element overflows its container — add `overflow-x: hidden` or `max-width: 100%` to the offending element. Check for fixed-width children inside a responsive container.",
  },
  {
    pattern: /\bmobile\b/i,
    hint: (_m, _e) =>
      "Issue on mobile viewport — review responsive breakpoints and ensure the layout adapts below 480px. Check for `min-width` or fixed `width` values that prevent shrinking.",
  },
  {
    pattern: /\btablet\b/i,
    hint: (_m, _e) =>
      "Issue on tablet viewport — check layout between 768px and 1024px. Consider adding a breakpoint for medium-sized screens.",
  },
  {
    pattern: /\bdesktop\b/i,
    hint: (_m, _e) =>
      "Issue on desktop viewport — verify the element at 1280px+ width. Check for max-width constraints or centering issues.",
  },
  {
    pattern: /element count (increase|decrease)/i,
    hint: (m, _e) => {
      const direction = m[1].toLowerCase();
      return direction === "increase"
        ? "Significant increase in DOM elements — check for unintended list rendering, duplicated components, or missing conditional guards."
        : "Significant decrease in DOM elements — verify that components are not accidentally removed. Check conditional rendering and route guards.";
    },
  },
  {
    pattern: /missing element/i,
    hint: (_m, _e) =>
      "Element is missing from the DOM — check if responsive CSS hides it (display: none in a media query) or if conditional rendering logic excludes it at this viewport size.",
  },
  {
    pattern: /added element/i,
    hint: (_m, _e) =>
      "Unexpected element appeared — verify the addition is intentional. If it is a responsive element, ensure it is hidden on viewports where it should not appear.",
  },
  {
    pattern: /became hidden/i,
    hint: (_m, _e) =>
      "Element visibility changed to hidden — check CSS display, visibility, and opacity rules. Look for media queries that toggle element visibility.",
  },
  {
    pattern: /became visible/i,
    hint: (_m, _e) =>
      "Element became visible — verify this is intentional. Check CSS media queries and conditional rendering that controls visibility.",
  },
  {
    pattern: /layout shift/i,
    hint: (_m, _e) =>
      "Significant layout shift detected — review CSS changes that affect position, width, or height. Look for missing explicit dimensions on images/containers or changed flex/grid properties.",
  },
  {
    pattern: /console.*error|error.*console/i,
    hint: (_m, _e) =>
      "Browser console error detected — open the dev server in a browser, check the console, and fix the JavaScript runtime error.",
  },
  {
    pattern: /navigation.*(?:fail|error|timeout)/i,
    hint: (_m, _e) =>
      "Page navigation failed — verify the route exists, the dev server is running, and the page does not redirect to an error page.",
  },
  {
    pattern: /dev server/i,
    hint: (_m, _e) =>
      "Dev server issue — ensure the dev server command in .forge.json is correct and the port is not already in use. Try running the dev server manually to check for startup errors.",
  },
];

/**
 * Build actionable remediation text for a visual validation error.
 *
 * Scans the error message for viewport and layout keywords, then returns
 * CSS/layout-specific fix hints. Falls back to generic visual advice when
 * no patterns match.
 */
export function buildVisualRemediation(error: GateError): string {
  const hints: string[] = [];

  // Collect all matching pattern hints (a visual error can match multiple)
  for (const { pattern, hint } of VISUAL_PATTERNS) {
    const match = error.message.match(pattern);
    if (match) {
      hints.push(hint(match, error));
    }
  }

  if (hints.length > 0) {
    // Deduplicate and join
    const unique = [...new Set(hints)];
    return unique.join(" ");
  }

  // Fallback
  return `Visual issue: ${error.message} — inspect the page in a browser at the failing viewport size and fix the layout.`;
}

// ---------------------------------------------------------------------------
// Review Error Remediation
// ---------------------------------------------------------------------------

/** Regex to extract PRD section references from review error messages */
const PRD_SECTION_RE = /PRD\s+(?:section\s+)?[""]?([^""]+)[""]?/i;

/** Regex to extract CLAUDE.md rule references */
const CLAUDE_RULE_RE = /CLAUDE\.md:\s*(\[[^\]]+\]|[^,.\n]+)/i;

/**
 * Build actionable remediation text for a code review finding.
 *
 * Adds PRD section references, CLAUDE.md rule citations, and concrete
 * next-step guidance so fix agents know exactly where to look.
 */
export function buildReviewRemediation(error: GateError): string {
  const parts: string[] = [];
  const location = formatLocation(error);

  // If the error already has remediation text, use it as the base
  if (error.remediation) {
    parts.push(error.remediation);
  }

  // Add PRD section reference if found in the message
  const prdMatch = PRD_SECTION_RE.exec(error.message);
  if (prdMatch) {
    const section = prdMatch[1].trim();
    parts.push(`Refer to PRD section "${section}" for the full acceptance criteria.`);
  }

  // Add CLAUDE.md rule reference if found
  const claudeMatch = CLAUDE_RULE_RE.exec(error.message);
  if (claudeMatch) {
    const rule = claudeMatch[1].trim();
    parts.push(`See CLAUDE.md rule ${rule} for the exact coding standard.`);
  }

  // Classify the finding type from message content
  if (/prd.*criterion|criterion.*not.*addressed/i.test(error.message)) {
    parts.push("Check that the current changes fulfill the acceptance criterion. If the criterion is out of scope for this milestone, note it for a future milestone.");
  }

  if (/rule.*violation|violation.*rule/i.test(error.message)) {
    parts.push("Fix the rule violation in the flagged file/line, then re-run the review gate to confirm compliance.");
  }

  if (/style/i.test(error.message) && /\bany\b/i.test(error.message)) {
    parts.push("Replace the `any` type with a specific type or `unknown` to satisfy strict TypeScript conventions.");
  }

  if (/TODO|FIXME|HACK/i.test(error.message)) {
    parts.push("Resolve or remove the TODO/FIXME/HACK marker before merging, or create a tracked issue for it.");
  }

  if (parts.length > 0) {
    const unique = [...new Set(parts)];
    return `${location}${unique.join(" ")}`;
  }

  // Fallback
  return `${location}Review finding: ${error.message} — address the issue and re-run the review gate.`;
}

// ---------------------------------------------------------------------------
// Test Coverage Remediation
// ---------------------------------------------------------------------------

/**
 * Build actionable remediation text for a test coverage error.
 *
 * Handles missing test files (enforcement mode) and zero-coverage baseline
 * failures. Returns file-specific instructions when a source file is
 * identified, or a general scaffolding instruction otherwise.
 */
export function buildTestCoverageRemediation(error: GateError): string {
  const location = formatLocation(error);

  // Missing test file for a specific source file (enforcement mode)
  if (error.file && /missing.*test|no.*test.*file/i.test(error.message)) {
    return `${location}Create a test file for this source file to satisfy enforcement. Run \`/forge:setup\` to scaffold tests automatically.`;
  }

  // Zero coverage / baseline failure
  if (/no tests found|zero.*coverage/i.test(error.message)) {
    return `${location}No tests exist in this project. Run \`/forge:setup\` to scaffold a test suite with the correct runner and directory structure.`;
  }

  // Thin coverage warning
  if (/thin.*coverage|low.*ratio/i.test(error.message)) {
    return `${location}Test coverage is very low. Prioritize adding tests for critical paths (API routes, business logic) first.`;
  }

  // Generic coverage remediation
  return `${location}Add test coverage for the identified file. Run \`/forge:setup\` to scaffold tests.`;
}

// ---------------------------------------------------------------------------
// Shared Utilities
// ---------------------------------------------------------------------------

/**
 * Format a file:line location prefix from a GateError.
 * Returns empty string if no file info is available.
 */
function formatLocation(error: GateError): string {
  if (error.file && error.line) {
    return `${error.file}:${error.line} — `;
  }
  if (error.file) {
    return `${error.file} — `;
  }
  return "";
}
