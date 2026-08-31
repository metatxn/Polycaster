import { AlertTriangle, CheckCircle2, ExternalLink, Info } from "lucide-react";

const PRODUCTION_ENDPOINT = "https://mcp.knoww.app/mcp";

const HOST_CONFIG = `{
  "mcpServers": {
    "knoww": {
      "type": "http",
      "url": "https://mcp.knoww.app/mcp"
    }
  }
}`;

const TYPESCRIPT_CLIENT = `import {
  Client,
  StreamableHTTPClientTransport,
  type AuthProvider,
} from "@modelcontextprotocol/client";

const authProvider: AuthProvider = {
  // Return the current access token without the "Bearer" prefix.
  token: async () => tokenStore.getAccessToken(),
  // Run the OAuth flow below, or refresh the rotating refresh token.
  onUnauthorized: async () => tokenStore.authorizeOrRefresh(),
};

const client = new Client(
  { name: "your-product", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } }
);

const transport = new StreamableHTTPClientTransport(
  new URL("https://mcp.knoww.app/mcp"),
  { authProvider }
);

await client.connect(transport);

const { tools } = await client.listTools();
const result = await client.callTool({
  name: "search_markets",
  arguments: { query: "bitcoin", limit: 3 },
});`;

const LOCAL_COMMANDS = `# Requires Node.js 24 and pnpm 10.25.0
node --version
pnpm --version

pnpm install
# Use dev:oauth to test Google sign-in. Use dev for the auth bypass.
pnpm --filter @knoww/mcp dev:oauth

# In a second terminal
pnpm --filter @knoww/web dev`;

const LOCAL_OAUTH_SECRETS = `GOOGLE_CLIENT_ID=replace-with-google-client-id
GOOGLE_CLIENT_SECRET=replace-with-google-client-secret`;

const LOCAL_CURL = `curl -sS http://localhost:8787/mcp \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -H 'Mcp-Protocol-Version: 2025-11-25' \\
  --data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "search_markets",
      "arguments": { "query": "bitcoin", "limit": 3 }
    }
  }'`;

const AUTHORIZATION_REQUEST = `GET /authorize?
  response_type=code
  &client_id=<registered-client-id>
  &redirect_uri=<exact-registered-redirect-uri>
  &scope=markets%3Aread
  &state=<cryptographically-random-state>
  &code_challenge=<S256-PKCE-challenge>
  &code_challenge_method=S256
  &resource=https%3A%2F%2Fmcp.knoww.app%2Fmcp`;

const TOKEN_REQUEST = `POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id=<registered-client-id>
&code=<authorization-code>
&code_verifier=<original-PKCE-verifier>
&redirect_uri=<exact-registered-redirect-uri>
&resource=https%3A%2F%2Fmcp.knoww.app%2Fmcp`;

export function McpIntegrationGuide() {
  return (
    <div className="space-y-16">
      <GuideSection
        id="connect"
        eyebrow="Quick start"
        title="Connect an MCP-compatible product"
        intro="Use this path when your product already supports remote MCP servers and interactive OAuth. Configuration keys differ by host, but the connection values do not."
      >
        <ol className="grid gap-3 lg:grid-cols-2">
          <Step number="1" title="Add a remote server">
            Name it <InlineCode>knoww</InlineCode> and set the URL to{" "}
            <InlineCode>{PRODUCTION_ENDPOINT}</InlineCode>.
          </Step>
          <Step number="2" title="Select Streamable HTTP">
            Do not select stdio, WebSocket, or the deprecated HTTP plus SSE
            transport.
          </Step>
          <Step number="3" title="Start standard OAuth">
            Let the host follow MCP protected-resource discovery. Do not ask the
            user to paste an access token.
          </Step>
          <Step number="4" title="Sign in with Google">
            The user reviews the requested scope, selects Continue with Google,
            and completes sign-in in the popup.
          </Step>
          <Step number="5" title="Confirm the permission">
            The only active scope is <InlineCode>markets:read</InlineCode>. It
            permits read-only market data and nothing else.
          </Step>
          <Step number="6" title="Discover and call tools">
            List the server tools, show their input schemas, and ask the user
            before sending a tool call when your product policy requires it.
          </Step>
        </ol>

        <CodeBlock
          label="Generic host configuration"
          code={HOST_CONFIG}
          note="Some products use a different file name or property shape. Enter the same server name, transport, and URL in that product's remote MCP settings."
        />

        <Callout icon="info" title="No API key or client secret is required">
          Knoww uses OAuth public clients. Prefer a Client ID Metadata Document
          when your host supports it. Dynamic Client Registration is available
          as a rate-limited compatibility path, and each registration is kept
          for 30 days.
        </Callout>
      </GuideSection>

      <GuideSection
        id="authentication"
        eyebrow="Security"
        title="Authentication and authorization"
        intro="Google sign-in proves which person approved the connection. OAuth scopes limit what the resulting MCP token may do. The controls are separate and both are enforced."
      >
        <div className="overflow-hidden rounded-md border">
          <div className="grid bg-muted/40 px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:grid-cols-[3rem_13rem_1fr] sm:px-5">
            <span>Step</span>
            <span className="hidden sm:block">Exchange</span>
            <span className="hidden sm:block">Client requirement</span>
          </div>
          <AuthRow
            number="1"
            name="Resource discovery"
            detail="Read /.well-known/oauth-protected-resource/mcp and verify that resource exactly matches the MCP URL."
          />
          <AuthRow
            number="2"
            name="Issuer discovery"
            detail="Read /.well-known/oauth-authorization-server, validate issuer equality, and require S256 PKCE support."
          />
          <AuthRow
            number="3"
            name="Client registration"
            detail="Use a Client ID Metadata Document when supported. Otherwise register the public client at /oauth/register with an exact redirect URI."
          />
          <AuthRow
            number="4"
            name="Authorization request"
            detail="Create cryptographically random state and a PKCE verifier. Send the S256 challenge, markets:read scope, and resource parameter."
          />
          <AuthRow
            number="5"
            name="Google sign-in"
            detail="Knoww redirects the user to Google with its own nonce, state, and S256 PKCE challenge. The MCP client never receives the Google code, ID token, access token, or client secret."
          />
          <AuthRow
            number="6"
            name="Callback validation"
            detail="Require the original state, validate the returned issuer when present or required, and reject any OAuth error before exchanging the code."
          />
          <AuthRow
            number="7"
            name="Token exchange"
            detail="Send the code, original verifier, exact redirect URI, client ID, and resource to /oauth/token."
          />
          <AuthRow
            number="8"
            name="Authenticated MCP calls"
            detail="Send Authorization: Bearer on every /mcp request. Never put tokens in a URL, JSON-RPC parameters, logs, analytics, or model context."
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <CodeBlock
            label="Authorization request fields"
            code={AUTHORIZATION_REQUEST}
          />
          <CodeBlock label="Authorization-code exchange" code={TOKEN_REQUEST} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Access token" value="1 hour" />
          <Fact label="Refresh token" value="30 days, rotating" />
          <Fact label="Sign-in state" value="5 minutes, one use" />
          <Fact label="Active scope" value="markets:read" mono />
        </div>

        <Callout icon="info" title="Google stays behind the Knoww boundary">
          Your product remains an OAuth public client and does not need Google
          credentials. Knoww exchanges the Google code on the server, verifies
          the signed ID token and nonce, and keeps only Google&apos;s stable
          subject identifier in the MCP grant. It does not retain the Google
          access token or email in the MCP token.
        </Callout>

        <p className="text-sm leading-6 text-muted-foreground">
          The explorer above stores its access token only in this tab&apos;s
          React memory. Reloading, changing the endpoint, or selecting
          Disconnect clears it. A product integration may use secure operating
          system storage, but it must never expose the token to the model.
        </p>
      </GuideSection>

      <GuideSection
        id="product-integration"
        eyebrow="Developers"
        title="Integrate Knoww into your product"
        intro="Use an MCP client library when possible. It handles the initialize handshake, content negotiation, tool schemas, and JSON-RPC response shapes for you."
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <CodeBlock
            label="TypeScript client"
            command="pnpm add @modelcontextprotocol/client"
            code={TYPESCRIPT_CLIENT}
            note="The authProvider is your product's OAuth boundary. It should perform discovery and PKCE, open the system browser, validate the callback, rotate refresh tokens, and return only the access token to the transport."
          />
          <div className="space-y-4">
            <ChecklistItem title="Treat tool content as data">
              Market titles and descriptions are untrusted content. Never
              interpret them as product or system instructions.
            </ChecklistItem>
            <ChecklistItem title="Use schema discovery">
              Call <InlineCode>tools/list</InlineCode> after connecting. Do not
              hard-code the current schema as the only source of truth.
            </ChecklistItem>
            <ChecklistItem title="Handle both response media types">
              A Streamable HTTP request may return JSON or an SSE stream with a
              JSON-RPC <InlineCode>data:</InlineCode> frame.
            </ChecklistItem>
            <ChecklistItem title="Propagate cancellation">
              Abort MCP requests when the user cancels or your request deadline
              expires.
            </ChecklistItem>
            <ChecklistItem title="Keep request IDs">
              Record the response <InlineCode>x-request-id</InlineCode> and the
              tool result&apos;s <InlineCode>meta.requestId</InlineCode> for
              support, without recording tokens or output bodies.
            </ChecklistItem>
          </div>
        </div>

        <div className="rounded-md border bg-muted/20 p-4 sm:p-5">
          <h3 className="font-semibold">Protocol compatibility</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The server supports the legacy 2025-11-25 flow and the modern
            2026-07-28 flow. Use SDK version negotiation when available. If you
            build raw requests, do not combine a 2026-07-28 protocol header with
            the classic <InlineCode>initialize</InlineCode> body.
          </p>
        </div>

        <Callout
          icon="warning"
          title="Direct browser integrations need an approved origin"
        >
          Desktop and server-side clients normally omit the Origin header and
          can connect after OAuth. A browser making direct cross-origin MCP
          calls must run on an allowlisted origin. Otherwise, route the MCP
          client through your backend or contact Knoww before launch.
        </Callout>
      </GuideSection>

      <GuideSection
        id="local-development"
        eyebrow="Local testing"
        title="Run the MCP server and explorer"
        intro="The local Worker supports Google OAuth for end-to-end testing. Its default dev command is the only mode that bypasses OAuth."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Runtime" value="Node.js 24" mono />
          <Fact label="Package manager" value="pnpm 10.25.0" mono />
          <Fact label="Local Worker" value="localhost:8787" mono />
          <Fact label="Local auth" value="Google OAuth or dev bypass" />
        </div>

        <CodeBlock
          label="Repository root"
          code={LOCAL_COMMANDS}
          note="Open http://localhost:8000/mcp-test and keep the server URL set to http://localhost:8787/mcp. OAuth discovery requires that exact canonical resource URL."
        />

        <div className="grid gap-4 md:grid-cols-2">
          <CodeBlock
            label="apps/mcp/.dev.vars"
            code={LOCAL_OAUTH_SECRETS}
            note="Use the client ID and secret from the same Google Web application. Wrangler does not copy Cloudflare production secrets into local development. Restart the local Worker after creating this ignored file."
          />
          <Callout icon="info" title="Allow the local Google callback">
            Add{" "}
            <InlineCode>http://localhost:8787/auth/google/callback</InlineCode>{" "}
            to the Google Web application&apos;s Authorized redirect URIs. The
            MCP explorer callback on port 8000 is registered with the local MCP
            server and does not belong in Google Cloud Console.
          </Callout>
        </div>

        <div className="grid gap-3 md:grid-cols-5">
          <TestStep number="1" tool="search_markets">
            Search for <InlineCode>bitcoin</InlineCode>. The explorer fills the
            remaining requests from the first live result.
          </TestStep>
          <TestStep number="2" tool="get_event">
            Review the live event slug, then execute.
          </TestStep>
          <TestStep number="3" tool="get_market">
            Review the live market slug, then execute.
          </TestStep>
          <TestStep number="4" tool="get_orderbook">
            Use the populated outcome token ID.
          </TestStep>
          <TestStep number="5" tool="get_price_history">
            Reuse the populated token ID for price samples.
          </TestStep>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <TestStep number="6" tool="market data getters">
            Run the populated quotes, trades, holders, open-interest, and live
            volume requests.
          </TestStep>
          <TestStep number="7" tool="discovery getters">
            Try events, tags, sports markets, and the trader leaderboard with
            their default arguments.
          </TestStep>
          <TestStep number="8" tool="public wallet getters">
            Paste a public Polymarket proxy wallet address into the profile,
            position, activity, PnL, closed-position, and portfolio requests.
          </TestStep>
        </div>

        <CodeBlock
          label="Raw local tool call"
          code={LOCAL_CURL}
          note="These calls use live Polymarket APIs, so the Worker needs internet access. Local dev bypass applies only to the Wrangler local environment."
        />
      </GuideSection>

      <GuideSection
        id="reference"
        eyebrow="Reference"
        title="HTTP endpoints and operating limits"
        intro="Only POST /mcp carries MCP messages. The other routes provide health checks and the OAuth lifecycle used by MCP clients."
      >
        <div className="overflow-hidden rounded-md border">
          <EndpointRow method="GET" path="/healthz" auth="Public">
            Worker liveness.
          </EndpointRow>
          <EndpointRow method="GET" path="/readyz" auth="Public">
            OAuth state-store and one-time authorization-state readiness.
          </EndpointRow>
          <EndpointRow
            method="GET"
            path="/.well-known/oauth-protected-resource/mcp"
            auth="Public"
          >
            MCP resource, authorization server, and supported scopes.
          </EndpointRow>
          <EndpointRow
            method="GET"
            path="/.well-known/oauth-authorization-server"
            auth="Public"
          >
            Issuer, authorization, token, registration, and PKCE metadata.
          </EndpointRow>
          <EndpointRow method="GET / POST" path="/authorize" auth="OAuth flow">
            Begin consent or continue to Google sign-in.
          </EndpointRow>
          <EndpointRow
            method="GET"
            path="/auth/google/callback"
            auth="Google callback"
          >
            Verify Google sign-in and complete MCP authorization. Products do
            not call this endpoint directly.
          </EndpointRow>
          <EndpointRow
            method="POST"
            path="/oauth/register"
            auth="Public, rate limited"
          >
            Dynamic public-client registration fallback.
          </EndpointRow>
          <EndpointRow method="POST" path="/oauth/token" auth="OAuth grant">
            Exchange an authorization code or rotate a refresh token.
          </EndpointRow>
          <EndpointRow method="POST" path="/mcp" auth="Bearer markets:read">
            Streamable HTTP MCP requests.
          </EndpointRow>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ReferenceCard title="Production quotas">
            <dl className="space-y-3 text-sm">
              <Definition
                term="OAuth routes"
                detail="30 requests per minute per route and source IP"
              />
              <Definition
                term="Worker edge"
                detail="300 requests per minute per source IP"
              />
              <Definition
                term="Authenticated principal"
                detail="120 requests per minute"
              />
              <Definition
                term="Each tool"
                detail="30 requests per minute per principal and tool"
              />
            </dl>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Treat HTTP 429 and <InlineCode>RATE_LIMITED</InlineCode> as
              retryable. Use bounded exponential backoff and avoid synchronized
              retries.
            </p>
          </ReferenceCard>

          <ReferenceCard title="Safe client behavior">
            <ul className="space-y-2 text-sm leading-6 text-muted-foreground">
              <li>
                Set Content-Type to application/json on MCP POST requests.
              </li>
              <li>Accept both application/json and text/event-stream.</li>
              <li>Keep MCP request bodies below 1 MiB.</li>
              <li>
                Render decimal-string prices without floating-point conversion.
              </li>
              <li>
                Respect meta.truncated and paginate or narrow the request.
              </li>
              <li>
                Never log authorization headers, OAuth codes, tokens, or raw
                tool output.
              </li>
            </ul>
          </ReferenceCard>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ErrorFact
            code="401"
            detail="Run or repeat OAuth, then retry with a fresh token."
          />
          <ErrorFact
            code="403"
            detail="Check markets:read, the resource audience, and browser Origin."
          />
          <ErrorFact
            code="429"
            detail="Back off. Repeated retries extend the failure."
          />
          <ErrorFact
            code="5xx"
            detail="Keep the request ID and retry only when the operation is safe."
          />
        </div>
      </GuideSection>

      <GuideSection
        id="troubleshooting"
        eyebrow="Support"
        title="Troubleshooting"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <TroubleshootingItem title="The server returns 401">
            Start protected-resource discovery from the URL in the
            WWW-Authenticate header. Ensure the token request and authorization
            request both include{" "}
            <InlineCode>resource={PRODUCTION_ENDPOINT}</InlineCode>.
          </TroubleshootingItem>
          <TroubleshootingItem title="The callback fails state or issuer validation">
            Keep the PKCE transaction in the same browser session, use the exact
            redirect URI, and compare normalized issuer URLs. Never continue
            after a mismatch.
          </TroubleshootingItem>
          <TroubleshootingItem title="Google sign-in does not return">
            Allow the authorization popup and third-party navigation, then
            restart the flow if its five-minute state expired. Product callback
            URIs belong to the MCP client; the Google Console redirect URI is
            the Knoww-owned <InlineCode>/auth/google/callback</InlineCode>{" "}
            route.
          </TroubleshootingItem>
          <TroubleshootingItem title="A browser request returns 403">
            The Origin may not be allowlisted. Use a desktop or backend MCP
            client, or arrange an origin review before a browser launch.
          </TroubleshootingItem>
          <TroubleshootingItem title="Local connect fails">
            Confirm Wrangler is listening on port 8787, use
            <InlineCode>http://localhost:8787/mcp</InlineCode>, and make sure
            the Worker started with the local environment.
          </TroubleshootingItem>
          <TroubleshootingItem title="A tool returns no market data">
            Start with <InlineCode>search_markets</InlineCode>. A successful
            search populates the other request editors with current identifiers.
            An empty price history can still be a valid response for a quiet
            token and time range.
          </TroubleshootingItem>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <ExternalLinkButton href="https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization">
            MCP authorization specification
          </ExternalLinkButton>
          <ExternalLinkButton href="https://modelcontextprotocol.io/specification/2026-07-28/basic/transports">
            Streamable HTTP specification
          </ExternalLinkButton>
          <ExternalLinkButton href="https://ts.sdk.modelcontextprotocol.io/v2/clients/connect">
            TypeScript client guide
          </ExternalLinkButton>
        </div>
      </GuideSection>
    </div>
  );
}

function GuideSection({
  children,
  eyebrow,
  id,
  intro,
  title,
}: {
  children: React.ReactNode;
  eyebrow: string;
  id: string;
  intro?: string;
  title: string;
}) {
  return (
    <section id={id} className="scroll-mt-24" aria-labelledby={`${id}-heading`}>
      <div className="mb-6 max-w-3xl">
        <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">
          {eyebrow}
        </p>
        <h2
          id={`${id}-heading`}
          className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          {title}
        </h2>
        {intro && (
          <p className="mt-3 leading-7 text-muted-foreground">{intro}</p>
        )}
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

function Step({
  children,
  number,
  title,
}: {
  children: React.ReactNode;
  number: string;
  title: string;
}) {
  return (
    <li className="flex gap-4 rounded-md border bg-card p-4 sm:p-5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-sm font-semibold text-primary-foreground">
        {number}
      </span>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {children}
        </p>
      </div>
    </li>
  );
}

function TestStep({
  children,
  number,
  tool,
}: {
  children: React.ReactNode;
  number: string;
  tool: string;
}) {
  return (
    <div className="rounded-md border bg-card p-4">
      <span className="font-mono text-xs text-primary">
        {number.padStart(2, "0")}
      </span>
      <h3 className="mt-3 break-all font-mono text-sm font-semibold">{tool}</h3>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{children}</p>
    </div>
  );
}

function CodeBlock({
  code,
  command,
  label,
  note,
}: {
  code: string;
  command?: string;
  label: string;
  note?: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border bg-zinc-950 text-zinc-100 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <span className="text-xs font-medium text-zinc-400">{label}</span>
        {command && (
          <code className="hidden text-xs text-zinc-500 sm:block">
            {command}
          </code>
        )}
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-6">
        <code>{code}</code>
      </pre>
      {note && (
        <p className="border-t border-white/10 px-4 py-3 text-xs leading-5 text-zinc-400">
          {note}
        </p>
      )}
    </div>
  );
}

function AuthRow({
  detail,
  name,
  number,
}: {
  detail: string;
  name: string;
  number: string;
}) {
  return (
    <div className="grid gap-1 border-t px-4 py-4 first:border-t-0 sm:grid-cols-[3rem_13rem_1fr] sm:items-start sm:gap-0 sm:px-5">
      <span className="font-mono text-xs text-primary">
        {number.padStart(2, "0")}
      </span>
      <span className="font-medium">{name}</span>
      <span className="text-sm leading-6 text-muted-foreground">{detail}</span>
    </div>
  );
}

function Callout({
  children,
  icon,
  title,
}: {
  children: React.ReactNode;
  icon: "info" | "warning";
  title: string;
}) {
  const Icon = icon === "warning" ? AlertTriangle : Info;
  return (
    <div className="flex gap-3 rounded-md border bg-muted/25 p-4 sm:p-5">
      <Icon
        className="mt-0.5 size-5 shrink-0 text-primary"
        aria-hidden="true"
      />
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {children}
        </p>
      </div>
    </div>
  );
}

function Fact({
  label,
  mono,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-2 text-sm font-semibold ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function ChecklistItem({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex gap-3">
      <CheckCircle2
        className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      />
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {children}
        </p>
      </div>
    </div>
  );
}

function EndpointRow({
  auth,
  children,
  method,
  path,
}: {
  auth: string;
  children: React.ReactNode;
  method: string;
  path: string;
}) {
  return (
    <div className="grid gap-2 border-t px-4 py-4 first:border-t-0 sm:grid-cols-[6.5rem_minmax(16rem,1fr)_10rem] sm:items-center sm:px-5 lg:grid-cols-[7rem_minmax(18rem,1fr)_12rem_1fr]">
      <span className="w-fit rounded bg-sky-700 px-2 py-1 font-mono text-[11px] font-bold text-white">
        {method}
      </span>
      <code className="break-all text-sm font-semibold">{path}</code>
      <span className="text-xs text-muted-foreground">{auth}</span>
      <span className="text-sm text-muted-foreground sm:col-span-3 lg:col-span-1">
        {children}
      </span>
    </div>
  );
}

function ReferenceCard({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="rounded-md border bg-card p-4 sm:p-5">
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Definition({ detail, term }: { detail: string; term: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
      <dt className="font-medium">{term}</dt>
      <dd className="max-w-xs text-right text-muted-foreground">{detail}</dd>
    </div>
  );
}

function ErrorFact({ code, detail }: { code: string; detail: string }) {
  return (
    <div className="rounded-md border bg-card p-4">
      <code className="font-semibold text-primary">HTTP {code}</code>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  );
}

function TroubleshootingItem({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="rounded-md border bg-card p-4 sm:p-5">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{children}</p>
    </div>
  );
}

function ExternalLinkButton({
  children,
  href,
}: {
  children: React.ReactNode;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="break-all rounded bg-muted px-1.5 py-0.5 text-[0.9em] text-foreground">
      {children}
    </code>
  );
}
