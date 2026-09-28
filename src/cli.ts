import { main } from "./main.js";

main().then((code) => {
  process.exitCode = code;
});
