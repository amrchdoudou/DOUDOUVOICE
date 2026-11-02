import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";

process.env.DOUDOU_TEST_MODE = "true";
process.env.STREAM_TOKEN_SECRET = "test-hmac-stream-token-secret-2026";

import {
  createApp,
  setVerifyIdTokenForTests,
  safeProjectId,
  createStreamToken,
  verifyStreamToken,
  resetCreatorRateLimitsForTests
} from "../server.js";
import { db } from "../src/db/index.js";
import { creatorProjects, videoProjects } from "../src/db/schema.js";
import { defaultMetaClient } from "./metaClient.js";
import { defaultMetaVideoClient } from "./metaVideoClient.js";

async function runSecurityTests() {
  console.log("=== Starting DoudouVoice Security & Provider Integrity Tests ===\n");

  // Mock Firebase verifyIdToken
  setVerifyIdTokenForTests(async (token: string) => {
    if (token === "token-user-a") {
      return { uid: "uid-user-a", email: "usera@example.com" };
    }
    if (token === "token-user-b") {
      return { uid: "uid-user-b", email: "userb@example.com" };
    }
    throw new Error("Invalid test token");
  });

  const app = await createApp({ skipVite: true });
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const testProjectId = "sec_test_proj_01";
  const testVideoProjectId = "sec_test_vid_01";

  try {
    // ------------------------------------------------------------------
    // 1. Without a token, every /api/creator/* and /api/video/stream/* returns 401
    // ------------------------------------------------------------------
    console.log("[Test 1] Verifying unauthenticated requests return 401...");

    const unauthRoutes: Array<{ method: string; path: string; body?: string; headers?: Record<string, string> }> = [
      { method: "POST", path: "/api/creator/upload-assets" },
      {
        method: "POST",
        path: "/api/creator/pipeline-all",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: testProjectId, assets: [] })
      },
      { method: "GET", path: `/api/creator/stream/${testProjectId}/final` },
      { method: "GET", path: `/api/creator/audio/${testProjectId}/voice_seg_1.wav` },
      { method: "GET", path: `/api/video/stream/${testVideoProjectId}` },
      { method: "GET", path: `/api/video/stream/${testVideoProjectId}/final` },
      { method: "POST", path: `/api/video/${testVideoProjectId}/stream-token` }
    ];

    for (const route of unauthRoutes) {
      const res = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: route.headers,
        body: route.body
      });
      assert.equal(
        res.status,
        401,
        `Expected 401 for unauthenticated ${route.method} ${route.path}, got ${res.status}`
      );
    }
    console.log("  ✓ All unauthenticated /api/creator/* and /api/video/stream/* routes returned 401.\n");

    // ------------------------------------------------------------------
    // 2. projectId "../../etc" returns 400 (path traversal blocked)
    // ------------------------------------------------------------------
    console.log('[Test 2] Verifying projectId "../../etc" returns 400...');

    // Direct helper check
    assert.throws(
      () => safeProjectId("../../etc"),
      (err: any) => err?.status === 400,
      'safeProjectId("../../etc") must throw status 400'
    );

    // Route check on /api/creator/pipeline-all
    const traversalPipelineRes = await fetch(`${baseUrl}/api/creator/pipeline-all`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token-user-a"
      },
      body: JSON.stringify({
        projectId: "../../etc",
        assets: [{ id: "a1", type: "image", filePath: "/tmp/x.png", originalName: "x.png", mimeType: "image/png" }]
      })
    });
    assert.equal(
      traversalPipelineRes.status,
      400,
      `Expected 400 for projectId "../../etc" on pipeline-all, got ${traversalPipelineRes.status}`
    );

    // Route check on /api/creator/upload-assets with traversal projectId
    const form = new FormData();
    form.append("projectId", "../../etc");
    form.append("mediaFiles", new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }), "test.png");

    const traversalUploadRes = await fetch(`${baseUrl}/api/creator/upload-assets`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-user-a"
      },
      body: form
    });
    assert.equal(
      traversalUploadRes.status,
      400,
      `Expected 400 for projectId "../../etc" on upload-assets, got ${traversalUploadRes.status}`
    );
    console.log('  ✓ Path traversal projectId "../../etc" rejected with 400.\n');

    // ------------------------------------------------------------------
    // 3. A second user cannot read or access the first user's project (404, never 403)
    // ------------------------------------------------------------------
    console.log("[Test 3] Verifying cross-user isolation returns 404...");

    // Upload an asset as User A to register ownership of testProjectId
    await db.delete(creatorProjects).where(eq(creatorProjects.id, testProjectId));
    const uploadFormA = new FormData();
    uploadFormA.append("projectId", testProjectId);
    uploadFormA.append("mediaFiles", new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }), "sample.png");

    const uploadResA = await fetch(`${baseUrl}/api/creator/upload-assets`, {
      method: "POST",
      headers: { Authorization: "Bearer token-user-a" },
      body: uploadFormA
    });
    assert.equal(uploadResA.status, 200, `User A upload should succeed with 200, got ${uploadResA.status}`);

    // Seed a videoProject owned by User A
    await db.delete(videoProjects).where(eq(videoProjects.id, testVideoProjectId));
    await db.insert(videoProjects).values({
      id: testVideoProjectId,
      uid: "uid-user-a",
      title: "User A Video",
      videoFilename: "original.mp4",
      videoUrl: `/api/video/stream/${testVideoProjectId}`,
      durationSec: 10,
      status: "uploaded",
      mode: "dub_ad"
    });

    // User B tries to access User A's creator project via pipeline-all, stream, audio, and stream-token
    const userBChecks = [
      await fetch(`${baseUrl}/api/creator/pipeline-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token-user-b"
        },
        body: JSON.stringify({
          projectId: testProjectId,
          assets: [{ id: "a1", type: "image", filePath: "/tmp/x.png", originalName: "x.png", mimeType: "image/png" }]
        })
      }),
      await fetch(`${baseUrl}/api/creator/stream/${testProjectId}/final`, {
        method: "GET",
        headers: { Authorization: "Bearer token-user-b" }
      }),
      await fetch(`${baseUrl}/api/creator/audio/${testProjectId}/voice_seg_1.wav`, {
        method: "GET",
        headers: { Authorization: "Bearer token-user-b" }
      }),
      await fetch(`${baseUrl}/api/video/${testProjectId}/stream-token`, {
        method: "POST",
        headers: { Authorization: "Bearer token-user-b" }
      }),
      await fetch(`${baseUrl}/api/video/stream/${testVideoProjectId}`, {
        method: "GET",
        headers: { Authorization: "Bearer token-user-b" }
      }),
      await fetch(`${baseUrl}/api/video/stream/${testVideoProjectId}/final`, {
        method: "GET",
        headers: { Authorization: "Bearer token-user-b" }
      })
    ];

    for (const res of userBChecks) {
      assert.equal(res.status, 404, `Expected 404 when User B accesses User A's project, got ${res.status}`);
    }

    // Also verify HMAC stream token roundtrip for User A works and mismatched projectId fails with 401
    const tokenIssueRes = await fetch(`${baseUrl}/api/video/${testProjectId}/stream-token`, {
      method: "POST",
      headers: { Authorization: "Bearer token-user-a" }
    });
    assert.equal(tokenIssueRes.status, 200, "User A should be able to issue stream token for own project");
    const tokenData: any = await tokenIssueRes.json();
    const verified = verifyStreamToken(tokenData.token, testProjectId);
    assert.equal(verified.uid, "uid-user-a");
    assert.throws(
      () => verifyStreamToken(tokenData.token, "other_project_id"),
      (err: any) => err?.status === 401
    );

    console.log("  ✓ Second user cannot read or access first user's project (returns 404).\n");

    // ------------------------------------------------------------------
    // 4. With META_STRICT=true and no META_API_KEY, script generation returns a clear error, not a Gemini result
    // ------------------------------------------------------------------
    console.log("[Test 4] Verifying META_STRICT=true with no META_API_KEY refuses Gemini fallback...");

    const prevMetaKey = process.env.META_API_KEY;
    const prevMetaStrict = process.env.META_STRICT;
    delete process.env.META_API_KEY;
    process.env.META_STRICT = "true";

    try {
      // 4a. Direct MetaClient.generateAdScript check
      const adScriptRes = await defaultMetaClient.generateAdScript({
        facts: {
          productName: "Doudou Earbuds",
          description: "Waterproof wireless earbuds"
        },
        dialect: "Algerian Arabic",
        platform: "TikTok",
        tone: "Friendly",
        duration: "15s"
      });
      assert.equal(adScriptRes.success, false, "generateAdScript must fail when META_STRICT=true and META_API_KEY is missing");
      assert.ok(
        adScriptRes.error && adScriptRes.error.includes("META_STRICT"),
        `Expected META_STRICT error message, got: ${adScriptRes.error}`
      );

      // 4b. Direct MetaVideoClient.generateAdvertisingVoiceover check
      const dubScriptRes = await defaultMetaVideoClient.generateAdvertisingVoiceover({
        scenes: [
          {
            id: "scene-1",
            startTimeSec: 0,
            endTimeSec: 5,
            description: "Close up of earbuds",
            hookPotential: "high"
          }
        ],
        durationSec: 15,
        dialect: "Algerian Arabic",
        platform: "TikTok",
        tone: "Energetic sales",
        voice: "Puck"
      });
      assert.equal(dubScriptRes.success, false, "generateAdvertisingVoiceover must fail when META_STRICT=true and META_API_KEY is missing");
      assert.ok(
        dubScriptRes.error && dubScriptRes.error.includes("META_STRICT"),
        `Expected META_STRICT error message, got: ${dubScriptRes.error}`
      );

      // 4c. HTTP endpoint check: POST /api/scriptwriter/generate
      const httpScriptRes = await fetch(`${baseUrl}/api/scriptwriter/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token-user-a"
        },
        body: JSON.stringify({
          facts: {
            productName: "Doudou Earbuds",
            description: "Waterproof wireless earbuds"
          },
          dialect: "Algerian Arabic",
          platform: "TikTok",
          tone: "Friendly",
          duration: "15s"
        })
      });
      assert.equal(httpScriptRes.ok, false, "HTTP /api/scriptwriter/generate must return non-200 when META_STRICT=true and no META_API_KEY");
      const httpScriptJson: any = await httpScriptRes.json();
      assert.ok(
        typeof httpScriptJson.error === "string" && httpScriptJson.error.includes("META_STRICT"),
        `Expected META_STRICT error from /api/scriptwriter/generate, got: ${JSON.stringify(httpScriptJson)}`
      );
      assert.equal(httpScriptJson.data, undefined, "Must not return a Gemini script result when META_STRICT=true");
    } finally {
      if (prevMetaKey !== undefined) process.env.META_API_KEY = prevMetaKey;
      else delete process.env.META_API_KEY;
      if (prevMetaStrict !== undefined) process.env.META_STRICT = prevMetaStrict;
      else delete process.env.META_STRICT;
    }

    console.log("  ✓ META_STRICT=true with missing META_API_KEY returned a clear error and blocked Gemini fallback.\n");
    console.log("=== ALL SECURITY & PROVIDER INTEGRITY TESTS PASSED ===");
  } finally {
    resetCreatorRateLimitsForTests();
    setVerifyIdTokenForTests(null);
    await db.delete(creatorProjects).where(eq(creatorProjects.id, testProjectId)).catch(() => {});
    await db.delete(videoProjects).where(eq(videoProjects.id, testVideoProjectId)).catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runSecurityTests().catch((err) => {
  console.error("Security test suite failed:", err);
  process.exit(1);
});
