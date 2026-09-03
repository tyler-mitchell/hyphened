import { createFileRoute } from "@tanstack/react-router";

/**
 * The in-page agent's only server surface: it forwards one request to one model provider so the
 * browser is not blocked by the provider's CORS policy.
 *
 * The key belongs to the judge, not to this host. It arrives in a header, is placed on the one
 * upstream request, and is never logged, never stored, never echoed back, and never written to
 * disk. This route holds no key of its own and refuses a request that carries none, so a
 * deployment cannot quietly bill an owner's account.
 */
const PROVIDERS = {
  anthropic: {
    extraHeaders: { "anthropic-version": "2023-06-01" },
    keyHeader: "x-api-key",
    keyPrefix: "",
    url: "https://api.anthropic.com/v1/messages",
  },
  openai: {
    extraHeaders: {},
    keyHeader: "authorization",
    keyPrefix: "Bearer ",
    url: "https://api.openai.com/v1/chat/completions",
  },
} as const;

type ProviderName = keyof typeof PROVIDERS;

const isProvider = (value: string | null): value is ProviderName =>
  value !== null && Object.hasOwn(PROVIDERS, value);

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const name = request.headers.get("x-agent-provider");
        if (!isProvider(name)) {
          return new Response(
            `Unknown model provider; send x-agent-provider as ${Object.keys(PROVIDERS).join(" or ")}.`,
            { status: 400 },
          );
        }
        const key = request.headers.get("x-agent-key")?.trim();
        if (key === undefined || key.length === 0) {
          return new Response(
            "This deployment holds no model key. Send your own in x-agent-key; it is used for this one request and never stored.",
            { status: 401 },
          );
        }
        const provider = PROVIDERS[name];
        // The body passes through unread. Nothing here inspects or records it.
        const upstream = await fetch(provider.url, {
          body: await request.text(),
          headers: {
            ...provider.extraHeaders,
            "content-type": "application/json",
            [provider.keyHeader]: `${provider.keyPrefix}${key}`,
          },
          method: "POST",
        }).catch(() => undefined);
        if (upstream === undefined) {
          return new Response(`The ${name} API could not be reached from this host.`, {
            status: 502,
          });
        }
        // The provider's own status and body reach the panel unchanged, so a bad key reads as the
        // provider's refusal rather than as a failure of this page.
        return new Response(upstream.body, {
          headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
          status: upstream.status,
        });
      },
    },
  },
});
