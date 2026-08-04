import fs from "node:fs";

const src = fs.readFileSync("supabase/migrations/20260709150000_chinese_rental_exchange.sql", "utf8");
const names = ["record_chinese_brought_exchange", "record_chinese_take"];
let out = "\n-- guarded chinese exchange RPCs (from 20260709150000)\n";

for (const fn of names) {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  if (start < 0) throw new Error(`missing ${fn}`);
  const end = src.indexOf("$$;", start) + 3;
  const body = src.slice(start, end).replace(/^BEGIN\r?\n/m, "BEGIN\n  PERFORM public.require_exchange_access();\n");
  out += `\n${body}\n`;
}

fs.appendFileSync("supabase/migrations/20260724120001_exchange_operator_rpc_guards.sql", out);
console.log("appended", names.join(", "));
