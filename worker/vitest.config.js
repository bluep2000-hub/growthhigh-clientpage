import {defineConfig} from "vitest/config";
import {readFileSync} from "node:fs";

// Wrangler의 Text HTML 모듈을 검사 환경에서도 같은 문자열로 읽는다.
export default defineConfig({plugins:[{name:"worker-text-html",enforce:"pre",load(id) {
  if (id.endsWith("/index.html")) return "export default "+JSON.stringify(readFileSync(id,"utf8"))+";";
}}]});
