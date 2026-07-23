import { build } from 'esbuild';

// Bundles @mycota/config's compiled code into the handler (it's a workspace
// package, not resolvable via a bare require() once this is zipped up and
// deployed) but leaves @aws-sdk/client-ssm external — it ships built into
// the Node 22 Lambda managed runtime already, same reasoning as
// infra/cdk/lambda/email-forwarder in the consuming btfp app.
await build({
  entryPoints: ['src/lambda/ephemeral-config-handler.ts'],
  outfile: 'lambda-dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  // CJS avoids needing a "type": "module" package.json inside the deployed
  // zip — Lambda's Node runtime treats a bare .js file as CJS by default.
  format: 'cjs',
  external: ['@aws-sdk/client-ssm'],
  sourcemap: true,
  minify: true,
  logLevel: 'info',
});
