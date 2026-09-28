import { silentRefresh } from "./browser/login.js";
import { browserFetch } from "./browser/transport.js";
import type { Command, Context, Outcome } from "./commands/define.js";
import { UberClient } from "./uber/client.js";

export type RuntimeOptions = {
  profile: string;
  interactive: boolean;
  headed: boolean;
  progress: (message: string) => void;
};

export async function execute(command: Command, input: Record<string, unknown>, options: RuntimeOptions): Promise<Outcome<unknown>> {
  const opened: { client?: UberClient } = {};
  const context: Context = {
    ...options,
    client: () => {
      opened.client ??= UberClient.open(options.profile, { refresher: silentRefresh, browserFetch: browserFetch(options.profile) });
      return opened.client;
    },
  };
  try {
    return await command.run(input as never, context);
  } finally {
    opened.client?.persist();
  }
}
