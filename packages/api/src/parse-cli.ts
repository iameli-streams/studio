import yargs from "yargs";
import yargsToMist from "./yargs-to-mist";
import {
  CamelKeys,
  Ingest,
  NodeAddress,
  OrchestratorNodeAddress,
  Price,
} from "./types/common";
import { defaultTaskExchange } from "./store/queue";

const DEFAULT_ARWEAVE_GATEWAY_PREFIXES = [
  "https://arweave.net/",
  "https://gateway.arweave.net/",
];

function coerceArr(arg: any) {
  if (!Array.isArray(arg)) {
    const arr = [];
    for (const [key, value] of Object.entries(arg)) {
      arr[key] = value;
    }
    return arr;
  }
  return arg;
}

function coerceJsonStrArr(arg: string): string[] {
  if (!arg) {
    return undefined;
  }
  const arr = JSON.parse(arg);
  const isStrArr =
    Array.isArray(arr) && arr.every((str) => typeof str === "string");
  if (!isStrArr) {
    throw new Error("not a JSON array of strings");
  }
  return arr;
}

function coerceRegexList(flagName: string) {
  return (arg: string): (string | RegExp)[] => {
    try {
      const arr = coerceJsonStrArr(arg);
      if (!arr) {
        return undefined;
      }
      return arr.map((str) => {
        if (str.startsWith("/") && str.endsWith("/")) {
          return new RegExp(str.slice(1, -1));
        }
        return str;
      });
    } catch (err) {
      throw new Error(`Error in CLI flag --${flagName}: ${err.message}`);
    }
  };
}

function coerceJsonValue<T>(flagName: string) {
  return (arg: string): T => {
    if (!arg) {
      return undefined;
    }

    try {
      return JSON.parse(arg);
    } catch (err) {
      throw new Error(`Error in CLI flag --${flagName}: ${err.message}`);
    }
  };
}

export type CliArgs = ReturnType<typeof parseCli>;

// Hack alert! We need to capture the args passed to yarns.options to generate the
// mist compatible config on -j. But assigning the `.options()` object to a variable
// before passing it to yargs completely breaks type inference, which is a huge shame.
// So... this monkeypatches yargs to capture that variable. If you know of a more
// elegant way, I'd love to hear it!
let args;
const originalOpts = yargs.options;
yargs.options = function (arg) {
  args = arg;
  return originalOpts.call(this, arg);
};

export default function parseCli(argv?: string | readonly string[]) {
  const parsed = yargs
    .options({
      port: {
        describe: "port to listen on",
        default: 3004,
        demandOption: true,
        type: "number",
      },
      "postgres-url": {
        describe: "url of a postgres database",
        type: "string",
        demandOption: true,
        default: "postgresql://postgres@localhost/livepeer",
      },
      "postgres-replica-url": {
        describe: "url of a postgres read replica database",
        type: "string",
      },
      "amqp-url": {
        describe: "the RabbitMQ Url",
        type: "string",
      },
      "amqp-tasks-exchange": {
        describe:
          "the name of the exchange for scheduling tasks and receiving results",
        type: "string",
        default: defaultTaskExchange,
      },
      "client-id": {
        describe: "google auth ID",
        type: "string",
      },
      "frontend-domain": {
        describe: "the domain used in templating urls, example: livepeer.org",
        type: "string",
        default: "livepeer.studio",
      },
      "kube-namespace": {
        describe:
          "namespace of the Kubernetes cluster we're in. required for Kubernetes service discovery.",
        type: "string",
      },
      "kube-broadcaster-service": {
        describe: "name of the service we should look at for broadcasters.",
        type: "string",
      },
      "kube-broadcaster-template": {
        describe:
          "template string of the form https://{{nodeName}}.example.com to give broadcasters external identity.",
        type: "string",
        default: "https://{{nodeName}}.livepeer.live",
      },
      "kube-orchestrator-service": {
        describe: "name of the service we should look at for orchestrators.",
        type: "string",
      },
      "kube-orchestrator-template": {
        describe:
          "template string of the form {{ip}} for the broadcaster webhook.",
        type: "string",
        default: "https://{{ip}}:8935",
      },
      "ipfs-gateway-url": {
        describe:
          "base URL to use for the IPFS content gateway returned on assets.",
        type: "string",
        default: "https://ipfs.livepeer.studio/ipfs/",
      },
      "trusted-ipfs-gateways": {
        describe:
          "comma-separated list of regexes for trusted IPFS gateways to automatically convert to IPFS URLs",
        type: "string",
        default: `["https://ipfs.livepeer.studio/ipfs/"]`,
        coerce: coerceRegexList("trusted-ipfs-gateways"),
      },
      "trusted-arweave-gateways": {
        describe:
          "comma-separated list of regexes for trusted Arweave gateways to automatically convert to Arweave URLs",
        type: "string",
        default: JSON.stringify(DEFAULT_ARWEAVE_GATEWAY_PREFIXES),
        coerce: coerceRegexList("trusted-arweave-gateways"),
      },
      "return-region-in-orchestrator": {
        describe: "return /api/region result also in /api/orchestrator",
        type: "boolean",
      },
      "subgraph-url": {
        describe: "URL of subgraph to look for orchestrators",
        type: "string",
      },
      "http-prefix": {
        describe: "accept requests at this prefix",
        default: "/api",
        demandOption: true,
        type: "string",
      },
      "fallback-proxy": {
        describe:
          "if a request would otherwise be a 404, send it here instead. useful for dev.",
        type: "string",
      },
      "jwt-secret": {
        describe:
          "phrase used to sign JSON web token, a way to securely transmit information between parties",
        type: "string",
      },
      "jwt-audience": {
        describe: "identifies the recipients that the JWT is intended for",
        type: "string",
      },
      "cors-jwt-allowlist": {
        describe:
          "comma-separated list of domains to allow CORS for requests authenticated with a JWT. " +
          "add a / prefix and suffix to an element to have it parsed as a regex",
        type: "string",
        default: `["https://livepeer.studio"]`,
        coerce: coerceRegexList("cors-jwt-allowlist"),
      },
      broadcasters: {
        describe:
          "hardcoded list of broadcasters to return from /api/broadcaster.",
        type: "string",
        default: "[]",
        coerce: coerceJsonValue<NodeAddress[]>("broadcasters"),
      },
      orchestrators: {
        describe:
          "hardcoded list of orchestrators to return from /api/orchestrator.",
        type: "string",
        default: "[]",
        coerce: coerceJsonValue<OrchestratorNodeAddress[]>("orchestrators"),
      },
      ingest: {
        describe: "hardcoded list of ingest points to return from /api/ingest.",
        type: "string",
        default: "[]",
        coerce: coerceJsonValue<Ingest[]>("ingest"),
      },
      prices: {
        describe:
          "hardcoded list of prices for broadcasters to return from /api/orchestrator/hook/auth",
        type: "string",
        default: "[]",
        coerce: coerceJsonValue<Price[]>("prices"),
      },
      "support-addr": {
        describe:
          "email address where outgoing emails originate. should be of the form name/email@example.com",
        type: "string",
        default: undefined,
        coerce: (supportAddr: string) => {
          if (!supportAddr) {
            return undefined;
          }
          const split = supportAddr.split("/");
          if (split.length !== 2) {
            throw new Error(
              `supportAddr should be of the form name / email, got ${supportAddr} `
            );
          }
          return split as [string, string];
        },
      },
      "sendgrid-api-key": {
        describe: "sendgrid api key for sending emails",
        type: "string",
      },
      "sendgrid-validation-api-key": {
        describe: "sendgrid api key for validating email addresses",
        type: "string",
      },
      "sendgrid-template-id": {
        describe: "sendgrid template id to use",
        type: "string",
      },
      "insecure-test-token": {
        describe:
          "[DO NOT USE EXCEPT FOR TESTING] token that test harness can use to bypass validation and access the database",
        type: "string",
      },
      region: {
        describe:
          "list of ingest endpoints to use as options for /api/geolocate",
        type: "array",
        default: [],
        coerce: coerceArr,
      },
      vodObjectStoreId: {
        describe: "object store ID to use for VOD",
        type: "string",
      },
      vodCatalystObjectStoreId: {
        describe: "object store ID to use for Catalyst VOD",
        type: "string",
      },
      vodCatalystPrivateAssetsObjectStoreId: {
        describe: "object store ID to use for private assets in Catalyst VOD",
        type: "string",
      },
      recordCatalystObjectStoreId: {
        describe: "object store ID used by Catalyst to store recordings",
      },
      catalystBaseUrl: {
        describe: "base URL of Catalyst",
        type: "string",
        default: "http://localhost:7979",
      },
      googleCloudUrlSigningKeyName: {
        describe:
          "name of the signing key to use for signing access cookies for private assets on Google Cloud CDN",
        type: "string",
      },
      googleCloudUrlSigningKey: {
        describe:
          "value of the signing key to use for signing access cookies for private assets on Google Cloud CDN",
        type: "string",
      },
      vodMaxConcurrentTasksPerUser: {
        describe:
          "maximum number of tasks that can be running for a given user",
        default: 5,
        type: "number",
      },
      vodMaxScheduledTasksPerUser: {
        describe:
          "maximum number of tasks that can be in the VOD execution queue for a given user",
        default: 100,
        type: "number",
      },
      "ingest-region": {
        describe:
          "list of ingest endpoints to use as servers to consult for /api/ingest",
        type: "array",
        default: [],
        coerce: coerceArr,
      },
      "api-region": {
        describe:
          "list of api endpoints to forward on incoming API requests. defining this delegates all non-geolocation tasks to the upstream servers",
        type: "array",
        default: [],
        coerce: coerceArr,
      },
      "record-object-store-id": {
        describe:
          "id of the object store that should be used for `record: true` requests that don't otherwise have an os",
        type: "string",
      },
      "supress-record-in-hook": {
        describe:
          "do not return record object store in /stream/hook response, even if it is specified in the stream object",
        type: "boolean",
      },
      "base-stream-name": {
        describe:
          "base stream name to be used in wildcard-based routing scheme.",
        type: "string",
      },
      "own-region": {
        describe: "identify region in which this server runs (fra, mdw, etc)",
        type: "string",
      },
      consul: {
        describe: "url of the Consul agent",
        type: "string",
      },
      "mist-port": {
        describe: "port of the Mist server",
        default: 4242,
        type: "number",
      },
      "mist-username": {
        describe: "username for Mist server",
        type: "string",
      },
      "mist-password": {
        describe: "password for Mist server",
        type: "string",
      },
      "stripe-secret-key": {
        describe: "Stripe secret key",
        type: "string",
      },
      "stripe-webhook-secret": {
        describe: "Stripe webhook secret",
        type: "string",
      },
      "verification-frequency": {
        describe: "verificationFreq field to return from stream/hook",
        default: 0,
        type: "number",
      },
      "recaptcha-secret-key": {
        describe: "google recaptcha secret key",
        type: "string",
      },
      "require-email-verification": {
        describe: "require Email Verification",
        default: false,
        type: "boolean",
      },
      "half-region-orchestrators-untrusted": {
        describe:
          "mark half of the orchestrators returned by /api/region as untrusted. For use in staging!",
        default: false,
        type: "boolean",
      },
      json: {
        describe: "print MistController-compatible json description",
        default: false,
        type: "boolean",
        alias: "j",
      },
      did: {
        describe: "Livepeer DID key",
        type: "string",
      },
      livekitHost: {
        describe: "Endpoint for LiveKit server",
        type: "string",
        default: "",
      },
      livekitApiKey: {
        describe: "API key for LiveKit access",
        type: "string",
      },
      livekitSecret: {
        describe: "Secret for LiveKit access",
        type: "string",
      },
      livekitMeetUrl: {
        describe: "Livekit Meet Webapp URL",
        type: "string",
        default: "https://meet.livekit.io/custom",
      },
    })
    .usage(
      `
    Livepeer Studio API Node

    Options my also be provided as LP_API_ prefixed environment variables, e.g. LP_API_PORT=5000 is the same as --port=5000.

    --broadcaster and --orchestrator options should be of the form
    [{"address":"https://127.0.0.1:3086","cliAddress":"http://127.0.0.1:3076"}]
    `
    )
    .strict(
      process.env.NODE_ENV !== "test" && process.env.NODE_ENV !== "development"
    )
    .env("LP_API_")
    .strict(
      process.env.NODE_ENV !== "test" && process.env.NODE_ENV !== "development"
    )
    .help()
    .parse(argv);
  if (parsed.json === true) {
    const mistOutput = yargsToMist(args);
    console.log(JSON.stringify(mistOutput));
    process.exit(0);
  }
  return parsed as any as CamelKeys<typeof parsed>;
}
