// Programmatic entrypoint into the Next.js server for `pkg` purposes.

const next = require("next");
const config = require("./next.config.js");

console.log(config);

const app = next({
  dir: __dirname,
  dev: false,
});
const getApp = async () => {
  await app.prepare();
  return app.getRequestHandler();
};
module.exports = getApp();
