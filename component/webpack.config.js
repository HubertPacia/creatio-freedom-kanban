const ModuleFederationPlugin = require("webpack/lib/container/ModuleFederationPlugin");
const mf = require("@angular-architects/module-federation/webpack");
const path = require("path");
const share = mf.share;

const sharedMappings = new mf.SharedMappings();
sharedMappings.register(path.join(__dirname, 'tsconfig.json'), []);

// 'hp_kanban' must match bootstrapCrtModule() and the folder Files/src/js/hp_kanban.
module.exports = {
  output: {
    uniqueName: "hp_kanban",
    publicPath: "auto",
    scriptType: 'text/javascript'
  },
  optimization: { runtimeChunk: false },
  // lodash (pulled in by @creatio-devkit/common) sees the shell's RequireJS `define` and writes itself to window._,
  // replacing the shell's underscore (`_.contains is not a function`, blank shell). lodash-es has no global side effect.
  resolve: { alias: { ...sharedMappings.getAliases(), lodash$: 'lodash-es' } },
  plugins: [
    new ModuleFederationPlugin({
      name: "hp_kanban",
      filename: "remoteEntry.js",
      exposes: { './RemoteEntry': './src/main.ts' },
      shared: share({ ...sharedMappings.getDescriptors() })
    }),
    sharedMappings.getPlugin()
  ],
};
