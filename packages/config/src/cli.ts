#!/usr/bin/env node
import { loadSsmConfig, pushSsmConfig, cloneSsmNamespace, deleteSsmNamespace } from './ssm-config.js';

const USAGE = `Usage:
  mycota-config load   --namespace <ns> --env <env> [--region <region>]
  mycota-config push   --namespace <ns> --env <env> --key <key> --value <value>
  mycota-config clone  --namespace <ns> --source <env> --target <env>
  mycota-config delete --namespace <ns> --env <env>

'load' prints dotenv-format KEY=VALUE lines to stdout — pipe/redirect it
(e.g. \`mycota-config load --namespace myapp --env dev > .env\`) rather than
reading it off the terminal, since it contains real secret values.`;

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (key && value !== undefined) args[key] = value;
  }
  return args;
}

function requireArg(args: Record<string, string>, name: string): string {
  const value = args[name];
  if (!value) {
    console.error(`Missing required --${name}\n\n${USAGE}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (command) {
    case 'load': {
      const config = await loadSsmConfig({
        namespace: requireArg(args, 'namespace'),
        env: requireArg(args, 'env'),
        region: args.region,
      });
      for (const [key, value] of Object.entries(config)) {
        console.log(`${key.toUpperCase().replace(/-/g, '_')}=${value}`);
      }
      break;
    }
    case 'push': {
      const written = await pushSsmConfig(
        { namespace: requireArg(args, 'namespace'), env: requireArg(args, 'env') },
        { [requireArg(args, 'key')]: requireArg(args, 'value') },
      );
      console.error(written.length ? `Wrote: ${written.join(', ')}` : 'Nothing written (empty value).');
      break;
    }
    case 'clone': {
      const written = await cloneSsmNamespace({
        namespace: requireArg(args, 'namespace'),
        sourceEnv: requireArg(args, 'source'),
        targetEnv: requireArg(args, 'target'),
      });
      console.error(`Cloned ${written.length} parameter(s):\n${written.join('\n')}`);
      break;
    }
    case 'delete': {
      const deleted = await deleteSsmNamespace({
        namespace: requireArg(args, 'namespace'),
        env: requireArg(args, 'env'),
      });
      console.error(`Deleted ${deleted.length} parameter(s):\n${deleted.join('\n')}`);
      break;
    }
    default:
      console.error(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
