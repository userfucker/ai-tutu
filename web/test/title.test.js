// 标题拆词统计：产品词 / 修饰词去重、重复的词、覆盖范围（Lee 给的例子）
import { test } from "node:test";
import assert from "node:assert/strict";
import { titleWords, titleLen } from "../server/analysis/stats.js";

test("尖头切尔西靴男英伦风休闲马丁靴男翘头高跟增高厚底高帮皮鞋靴子", () => {
  const title = "尖头切尔西靴男英伦风休闲马丁靴男翘头高跟增高厚底高帮皮鞋靴子";
  const split = "尖头/切尔西靴*/男/英伦风/休闲/马丁靴*/男/翘头/高跟/增高/厚底/高帮/皮鞋*/靴子*".split("/").map((x) => ({ w: x.replace("*", ""), t: x.endsWith("*") ? "core" : "mod" }));
  const r = titleWords(title, { words: split });
  assert.deepEqual(r.core, ["切尔西靴", "马丁靴", "皮鞋", "靴子"]);
  assert.equal(r.mod.length, 9, "修饰词去重后 9 个");
  assert.deepEqual(r.repeats, [{ w: "男", n: 2 }], "重复的只有“男”");
  assert.equal(r.coverage, 36, "4 × 9 = 36");
  assert.equal(r.firstCore, 2, "产品词从第 3 个字开始");
  assert.equal(r.matches, true);
  assert.equal(titleLen(title), 60);
});
