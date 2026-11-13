import assert from "node:assert/strict";
import {
  normalizeQuotes,
  splitTopLevel,
  parseAssignments,
  analyzeTemplate,
  findFunctions,
  resolveCallTarget,
  normalizeOutput,
  compareOutput,
} from "../web/static/js/runner.js";

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL - ${name}: ${err.message}`);
  }
}

test("normalizeQuotes converts curly quotes", () => {
  assert.equal(normalizeQuotes("\u201cnums\u201d \u2018x\u2019"), '"nums" \'x\'');
});

test("splitTopLevel respects quotes and brackets", () => {
  assert.deepEqual(splitTopLevel('nums = [2,7,11,15], target = 9'), [
    "nums = [2,7,11,15]",
    "target = 9",
  ]);
  assert.deepEqual(splitTopLevel('"a,b", c'), ['"a,b"', "c"]);
  assert.deepEqual(splitTopLevel("(1,2), 3"), ["(1,2)", "3"]);
});

test("parseAssignments names, values, positional entries", () => {
  assert.deepEqual(parseAssignments("nums = [2,7,11,15], target = 9"), [
    { name: "nums", value: "[2,7,11,15]" },
    { name: "target", value: "9" },
  ]);
  assert.deepEqual(parseAssignments("3\nabc"), [
    { name: "", value: "3" },
    { name: "", value: "abc" },
  ]);
  assert.deepEqual(parseAssignments("= 5"), []);
});

test("analyzeTemplate python drops self and annotations", () => {
  const t = "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:";
  assert.deepEqual(analyzeTemplate(t, "python3"), {
    name: "twoSum",
    params: ["nums", "target"],
  });
  assert.deepEqual(analyzeTemplate("", "python3"), { name: null, params: [] });
});

test("analyzeTemplate js declaration, var assignment, arrow", () => {
  assert.deepEqual(analyzeTemplate("var twoSum = function(nums, target) {", "javascript"), {
    name: "twoSum",
    params: ["nums", "target"],
  });
  assert.deepEqual(analyzeTemplate("function twoSum(nums, target) {", "javascript"), {
    name: "twoSum",
    params: ["nums", "target"],
  });
  assert.deepEqual(analyzeTemplate("const twoSum = (nums, target) => {", "javascript"), {
    name: "twoSum",
    params: ["nums", "target"],
  });
});

test("findFunctions python and js", () => {
  assert.deepEqual(findFunctions("def twoSum(a, b):\n    return [0]\n\ndef helper():\n    pass", "python3"), [
    "twoSum",
    "helper",
  ]);
  assert.deepEqual(findFunctions("var twoSum = function(a) {};", "javascript"), ["twoSum"]);
});

test("resolveCallTarget template match, single fallback, none, ambiguous", () => {
  assert.deepEqual(resolveCallTarget("def twoSum(a):\n    return a", "python3", "twoSum"), {
    name: "twoSum",
  });
  assert.deepEqual(resolveCallTarget("def solve(a):\n    return a", "python3", "twoSum"), {
    name: "solve",
  });
  assert.ok(resolveCallTarget("x = 1", "python3", "twoSum").error);
  assert.ok(resolveCallTarget("def a():\n    pass\ndef b():\n    pass", "python3", null).error);
});

test("normalizeOutput trims and folds line endings", () => {
  assert.equal(normalizeOutput("  [0, 1]  \r\n"), "[0, 1]");
  assert.equal(normalizeOutput("a  \n b"), "a\n b");
});

test("compareOutput exact, whitespace-insensitive, none", () => {
  assert.equal(compareOutput("[0, 1]", "[0, 1]"), true);
  assert.equal(compareOutput("[0, 1]", "[0,1]"), true);
  assert.equal(compareOutput("[0, 1]", "[1, 0]"), false);
  assert.equal(compareOutput("x", ""), null);
  assert.equal(compareOutput("x", null), null);
});

if (failures) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log("all runner tests passed");
