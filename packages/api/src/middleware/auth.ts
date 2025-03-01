import { URL } from "url";
import basicAuth from "basic-auth";
import corsLib, { CorsOptions } from "cors";
import { Request, RequestHandler, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

import { pathJoin2, trimPathPrefix } from "../controllers/helpers";
import { ApiToken, User } from "../schema/types";
import { db } from "../store";
import { ForbiddenError, UnauthorizedError } from "../store/errors";
import { WithID } from "../store/types";
import { AuthRule, AuthPolicy } from "./authPolicy";
import tracking from "./tracking";

type AuthScheme = "jwt" | "bearer" | "basic";

function parseAuthHeader(authHeader: string) {
  const match = authHeader?.match(/^\s*(\w+)\s+(.+)$/);
  if (!match) return {};
  return {
    rawAuthScheme: match[1],
    authScheme: match[1].trim().toLowerCase() as AuthScheme,
    authToken: match[2].trim(),
  };
}

function isAuthorized(
  method: string,
  path: string,
  rules: AuthRule[],
  httpPrefix?: string
) {
  try {
    const policy = new AuthPolicy(rules);
    if (httpPrefix) {
      path = trimPathPrefix(httpPrefix, path);
    }
    return policy.allows(method, path);
  } catch (err) {
    console.error(`error authorizing ${method} ${path}: ${err}`);
    return false;
  }
}

/**
 * Creates a middleware that parses and verifies the authentication method from
 * the request and populates the `express.Request` object.
 *
 * @remarks
 * The only auth method supported is the `Authorization` header. It can use:
 *  * the `Bearer` scheme with an API key (used by external applications);
 *  * the `JWT` scheme with a JWT token (used by the dashboard), or;
 *  * the `Basic` scheme with an `userId` as the username and an API key from
 *    that user as the `password` (used by `go-livepeer` that only supports a
 *    URL to specify some endpoints like the stream auth webhook).
 *
 * @remarks
 * It is supposed to be used as a global middleware that runs for every request
 * and should be used in conjunction with the `authorizer` middleware below.
 *
 * As such it allows requests without any authentication method to pass through.
 * If the specific API requires a user, it must add an {@link authorizer}
 * middleware which will fail if the request is not authenticated.
 */
function authenticator(): RequestHandler {
  return async (req, res, next) => {
    res.vary("Authorization");
    const authHeader = req.headers.authorization;
    const { authScheme, authToken, rawAuthScheme } =
      parseAuthHeader(authHeader);
    const basicUser = basicAuth.parse(authHeader);
    let user: User;
    let tokenObject: WithID<ApiToken>;
    let userId: string;

    if (!authScheme) {
      return next();
    } else if (["bearer", "basic"].includes(authScheme)) {
      const isBasic = authScheme === "basic";
      const tokenId = isBasic ? basicUser?.pass : authToken;
      if (!tokenId) {
        throw new UnauthorizedError(`no authorization token provided`);
      }
      tokenObject = await db.apiToken.get(tokenId);
      const matchesBasicUser = tokenObject?.userId === basicUser?.name;
      if (!tokenObject || (isBasic && !matchesBasicUser)) {
        throw new UnauthorizedError(`no token ${tokenId} found`);
      }

      userId = tokenObject.userId;
      // track last seen
      tracking.recordToken(tokenObject);
    } else if (authScheme === "jwt") {
      try {
        const verified = jwt.verify(authToken, req.config.jwtSecret, {
          audience: req.config.jwtAudience,
        }) as JwtPayload;
        userId = verified.sub;
        tracking.recordUser(userId);
      } catch (err) {
        throw new UnauthorizedError(err.message);
      }
    } else {
      throw new UnauthorizedError(
        `unsupported authorization header scheme: ${rawAuthScheme}`
      );
    }

    user = await db.user.get(userId);
    if (!user) {
      throw new UnauthorizedError(
        `no user found from authorization header: ${authHeader}`
      );
    }
    if (user.suspended) {
      throw new ForbiddenError(`user is suspended`);
    }

    req.user = user;
    // UI admins must have a JWT
    req.isUIAdmin = user.admin && authScheme === "jwt";
    req.token = tokenObject;
    return next();
  };
}

type CorsParams = {
  baseOpts: CorsOptions;
  anyOriginPathPrefixes: string[];
  jwtOrigin: (string | RegExp)[];
};

function cors(params: CorsParams): RequestHandler {
  const { baseOpts, anyOriginPathPrefixes, jwtOrigin } = params;
  const anyOriginOpts = { ...baseOpts, origin: true };
  const jwtOpts = { ...baseOpts, origin: jwtOrigin };
  const getCorsOpts = (req: Request) => {
    const { method, path, token } = req;
    const allowAny =
      anyOriginPathPrefixes.some((p) => path.startsWith(p)) ||
      (!token && method === "OPTIONS");
    if (allowAny) {
      return anyOriginOpts;
    } else if (!token) {
      return jwtOpts;
    }
    const allowedOrigins = token.access?.cors?.allowedOrigins ?? [];
    return allowedOrigins.includes("*")
      ? anyOriginOpts
      : {
          ...baseOpts,
          origin: allowedOrigins,
        };
  };

  return corsLib((req, callback) => callback(null, getCorsOpts(req)));
}

function authenticateWithCors(params: { cors: CorsParams }): RequestHandler {
  const auth = authenticator();
  const _cors = cors(params.cors);
  return async (req, res, next) => {
    const corsNext = (err1: any) => {
      const joinedNext = (err2: any) => next(err1 ?? err2);
      try {
        _cors(req, res, joinedNext);
      } catch (err) {
        joinedNext(err);
      }
    };
    try {
      // we know that auth middleware is async
      await auth(req, res, corsNext);
    } catch (err) {
      // make sure we call cors even on thrown auth errs
      corsNext(err);
    }
  };
}

export const corsApiKeyAccessRules: AuthRule[] = [
  // Live-streaming
  {
    methods: ["get"],
    resources: [
      "/stream/:id/sessions",
      "/stream/sessions/:parentId",
      "/session/:id",
    ],
  },
  {
    methods: ["get", "patch"],
    resources: ["/stream/:id", "/multistream/target/:id"],
  },
  {
    methods: ["post"],
    resources: ["/stream", "/multistream/target"],
  },
  // VOD
  {
    methods: ["get"],
    resources: ["/task/:id"],
  },
  {
    methods: ["get", "patch"],
    resources: ["/asset/:id"],
  },
  {
    methods: ["post"],
    resources: [
      "/asset/upload/url",
      "/asset/request-upload",
      "/asset/:id/transcode",
      "/asset/transcode", // legacy, remove
      "/asset/:id/export",
    ],
  },
  // Data
  {
    methods: ["get"],
    resources: [
      "/data/views/:id/total",
      "/data/views/query/total/:id",
      "/data/views/query/creator",
    ],
  },
  // Experiment
  {
    methods: ["post"],
    resources: ["/experiment/-/attestation"],
  },
];

function isRestrictedCors(token?: ApiToken) {
  if (!token || token.access?.rules) {
    // explicit access rules override any default restriction
    return false;
  }
  const { allowedOrigins, fullAccess } = token.access?.cors ?? {};
  const hasCors = allowedOrigins?.length > 0;
  return hasCors && !fullAccess;
}

function tokenAccessRules(token?: ApiToken) {
  return isRestrictedCors(token) ? corsApiKeyAccessRules : token?.access?.rules;
}

interface AuthzParams {
  allowUnverified?: boolean;
  admin?: boolean;
  anyAdmin?: boolean;
  noApiToken?: boolean;
  originalUriHeader?: string;
}

/**
 * Creates a customizable authorization middleware that ensures any access
 * restrictions are met for the request to go through.
 *
 * @remarks
 * This has a strict dependency on the {@link authenticator} middleware above.
 * If that middleware hasn't run in the request before this one, all requests
 * will be rejected.
 *
 * @remarks
 * This middleware will also do a CORS check on the `Origin` header. This is
 * necessary here, apart from only letting the browser do its thing, because we
 * do a non-standard thing on the pre-flight OPTIONS request. That is to allow
 * all pre-flight requests to pass through (check CORS middleware above) and
 * only do any actual filtering on the real/"post-flight" request. We need that
 * because we change the CORS policy based on the API key in the `Authorization`
 * header and the browser does not send it on the pre-flight. Then to disallow
 * the actual request to go through we need the explicit check and block here.
 */
function authorizer(params: AuthzParams): RequestHandler {
  return async (req, res, next) => {
    const { user, isUIAdmin, token } = req;
    if (!user) {
      throw new UnauthorizedError(`request is not authenticated`);
    }
    if (token && params.noApiToken) {
      throw new ForbiddenError(`access forbidden for API keys`);
    }
    const reqOrigin = req.headers["origin"];
    // cors middleware before will set the header (check func remark for ctx)
    const resOrigin = res.getHeader("access-control-allow-origin")?.toString();
    if (reqOrigin && reqOrigin !== resOrigin) {
      throw new ForbiddenError(
        `credential disallows CORS access from origin ${reqOrigin}`
      );
    }

    const verifyEmail =
      req.config.requireEmailVerification && !params.allowUnverified;
    if (verifyEmail && !user.emailValid) {
      throw new ForbiddenError(
        `user ${user.email} has not been verified. please check your inbox for verification email.`
      );
    }

    if ((params.admin && !isUIAdmin) || (params.anyAdmin && !user.admin)) {
      throw new ForbiddenError(`user does not have admin priviledges`);
    }
    if (token?.access?.cors && req.user.admin) {
      throw new ForbiddenError(
        `cors access is not available to admins (how did you get this API key?)`
      );
    }
    const accessRules = tokenAccessRules(token);
    if (accessRules) {
      const { httpPrefix } = req.config;
      let fullPath = pathJoin2(req.baseUrl, req.path);
      if (params.originalUriHeader) {
        const header = req.headers[params.originalUriHeader];
        const originalUri = new URL(header?.toString() ?? "");
        fullPath = originalUri.pathname;
      }
      if (!isAuthorized(req.method, fullPath, accessRules, httpPrefix)) {
        throw new ForbiddenError(
          isRestrictedCors(token)
            ? "access forbidden for CORS-enabled API key with restricted access"
            : "credential has insufficent privileges"
        );
      }
    }
    return next();
  };
}

export { authenticator, cors, authenticateWithCors, authorizer };
