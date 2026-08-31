import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  buildGoogleAuthorizationUrl,
  createGooglePkce,
  exchangeGoogleAuthorizationCode,
  GoogleAuthenticationError,
  googleAuthenticationLogFields,
  verifyGoogleIdToken,
} from "./google";

const CLIENT_ID = "google-test-client.apps.googleusercontent.com";
const REDIRECT_URI = "https://mcp.knoww.app/auth/google/callback";

describe("Google OIDC", () => {
  it("builds a code-flow authorization URL with state, nonce, and S256 PKCE", async () => {
    const pkce = await createGooglePkce();
    const url = new URL(
      buildGoogleAuthorizationUrl({
        clientId: CLIENT_ID,
        codeChallenge: pkce.challenge,
        nonce: "nonce-123",
        redirectUri: REDIRECT_URI,
        state: "state-123",
      })
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("nonce")).toBe("nonce-123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge);
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });

  it("exchanges the one-time code without exposing the client secret in the URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        access_token: "unused-google-access-token",
        expires_in: 3600,
        id_token: "signed-google-id-token",
        token_type: "Bearer",
      })
    );

    await expect(
      exchangeGoogleAuthorizationCode({
        clientId: CLIENT_ID,
        clientSecret: "google-test-secret",
        code: "one-time-code",
        codeVerifier: "v".repeat(64),
        fetchImpl,
        redirectUri: REDIRECT_URI,
      })
    ).resolves.toBe("signed-google-id-token");

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://oauth2.googleapis.com/token");
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toContain("client_secret=google-test-secret");
    expect(String(input)).not.toContain("google-test-secret");
  });

  it("verifies the Google signature, issuer, audience, nonce, and verified email", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    const keyResolver = createLocalJWKSet({
      keys: [{ ...publicJwk, alg: "RS256", kid: "google-test-key" }],
    });
    const token = await new SignJWT({
      email: "person@example.com",
      email_verified: true,
      nonce: "nonce-123",
    })
      .setProtectedHeader({ alg: "RS256", kid: "google-test-key" })
      .setIssuer("https://accounts.google.com")
      .setSubject("102030405060708090")
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(
      verifyGoogleIdToken({
        clientId: CLIENT_ID,
        idToken: token,
        keyResolver,
        nonce: "nonce-123",
      })
    ).resolves.toEqual({ subject: "102030405060708090" });

    await expect(
      verifyGoogleIdToken({
        clientId: CLIENT_ID,
        idToken: token,
        keyResolver,
        nonce: "different-nonce",
      })
    ).rejects.toMatchObject({
      googleFailure: "verification_failed",
      googleStage: "id_token_verification",
      message: "Google identity could not be verified.",
    });

    await expect(
      verifyGoogleIdToken({
        clientId: "different-client.apps.googleusercontent.com",
        idToken: token,
        keyResolver,
        nonce: "nonce-123",
      })
    ).rejects.toThrow("Google identity could not be verified");

    const unverifiedEmailToken = await new SignJWT({
      email: "person@example.com",
      email_verified: false,
      nonce: "nonce-123",
    })
      .setProtectedHeader({ alg: "RS256", kid: "google-test-key" })
      .setIssuer("https://accounts.google.com")
      .setSubject("102030405060708090")
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(
      verifyGoogleIdToken({
        clientId: CLIENT_ID,
        idToken: unverifiedEmailToken,
        keyResolver,
        nonce: "nonce-123",
      })
    ).rejects.toThrow("Google identity could not be verified");
  });

  it("classifies a rejected token exchange without exposing Google's response", async () => {
    let failure: unknown;
    try {
      await exchangeGoogleAuthorizationCode({
        clientId: CLIENT_ID,
        clientSecret: "google-test-secret",
        code: "rejected-code",
        codeVerifier: "v".repeat(64),
        fetchImpl: async () =>
          Response.json(
            {
              error: "invalid_client",
              error_description: "sensitive upstream detail",
            },
            { status: 401 }
          ),
        redirectUri: REDIRECT_URI,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(GoogleAuthenticationError);
    expect(failure).toMatchObject({
      googleFailure: "upstream_rejected",
      googleOAuthError: "invalid_client",
      googleStage: "token_exchange",
      googleUpstreamStatus: 401,
      message: "Google authentication failed.",
    });
    expect(String(failure)).not.toContain("sensitive upstream detail");
  });

  it("classifies malformed token responses separately from exchange rejection", async () => {
    await expect(
      exchangeGoogleAuthorizationCode({
        clientId: CLIENT_ID,
        clientSecret: "google-test-secret",
        code: "accepted-code",
        codeVerifier: "v".repeat(64),
        fetchImpl: async () => Response.json({ access_token: "unused" }),
        redirectUri: REDIRECT_URI,
      })
    ).rejects.toMatchObject({
      googleFailure: "invalid_response",
      googleStage: "token_exchange",
    });
  });

  it("returns an allowlisted diagnostic object and redacts unknown errors", () => {
    expect(
      googleAuthenticationLogFields(
        new GoogleAuthenticationError({
          googleFailure: "upstream_rejected",
          googleOAuthError: "invalid_grant",
          googleStage: "token_exchange",
          googleUpstreamStatus: 400,
        })
      )
    ).toEqual({
      googleFailure: "upstream_rejected",
      googleOAuthError: "invalid_grant",
      googleStage: "token_exchange",
      googleUpstreamStatus: 400,
    });
    expect(
      googleAuthenticationLogFields(new Error("secret must not reach logs"))
    ).toEqual({
      googleFailure: "unexpected_error",
      googleStage: "unknown",
    });
  });
});
