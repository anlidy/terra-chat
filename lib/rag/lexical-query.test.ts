import assert from "node:assert/strict";
import test from "node:test";

import { buildTsQuery } from "./lexical-query";

test("buildTsQuery preserves English words and ignores punctuation", () => {
  assert.equal(
    buildTsQuery("Does Corning have positive working capital?"),
    "'Does' & 'Corning' & 'have' & 'positive' & 'working' & 'capital'"
  );
});

test("buildTsQuery treats ampersands as punctuation", () => {
  assert.equal(
    buildTsQuery("Cash & Cash equivalents"),
    "'Cash' & 'Cash' & 'equivalents'"
  );
});

test("buildTsQuery segments Chinese terms with prefix matching", () => {
  assert.equal(
    buildTsQuery("中国的首都是哪里？"),
    "'中国':* & '的':* & '首都':* & '是':* & '哪里':*"
  );
});

test("buildTsQuery returns an empty query for punctuation-only input", () => {
  assert.equal(buildTsQuery("?! &"), "");
});
