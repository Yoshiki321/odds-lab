/** temp_inspect.cjs */
const fs = require("fs");
const d = "data/experiment_survival_100/runtime/";
for (const f of ["api_catalog_full.json", "api_results_capture.json"]) {
  const j = JSON.parse(fs.readFileSync(d + f, "utf8"));
  for (const e of j.endpoints) {
    if (/getAllInPlayMatchListPB|getOrderListPB|getPreBetOrderListPB|queryCashOutMaxAmountListPB|user\/amount/.test(e.endpoint)) {
      console.log(f + " | " + e.endpoint + " | " + e.method + " | req=" + JSON.stringify(e.requestFields || []) + " | query=" + JSON.stringify(e.queryKeys || []));
    }
  }
}
