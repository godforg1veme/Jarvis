const { parseIntent } = require("./intentParser");

const { executeIntent } = require("../actions/executeIntent");



async function main() {

  const text = process.argv.slice(2).join(" ") || "джарвис включи доту";



  console.log("[test] text:", text);



  const intent = parseIntent(text);



  console.log("[test] intent:", intent);



  const result = await executeIntent(intent);



  console.log("[test] result:", result);



}



main().catch((error) => {

  console.error(error);

  process.exit(1);

});