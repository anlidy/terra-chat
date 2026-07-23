import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

type MockStreamOptions = {
  fail?: boolean;
  intervalMs?: number;
  kind?: "text" | "code" | "sheet" | "image";
};

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";

async function installArtifactStream(
  page: Page,
  { fail = false, intervalMs = 3, kind = "text" }: MockStreamOptions = {}
) {
  await page.addInitScript(
    ({ shouldFail, delay, documentId, artifactKind }) => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (!url.endsWith("/api/chat")) {
          return originalFetch(input, init);
        }

        const encoder = new TextEncoder();
        const markdownStart =
          "# Streaming artifact\n\n实时正文 **visible** with [link](https://example.com).\n\n- first\n- 第二项\n\n";
        const snapshotContent = {
          code: 'print("ready")',
          sheet: "name,value\nready,2",
          image:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
        } as const;
        const streamParts: Record<string, unknown>[] =
          artifactKind === "text"
            ? [
                {
                  type: "data-textDelta",
                  data: markdownStart,
                  transient: true,
                },
                ...Array.from({ length: 90 }, (_, index) => ({
                  type: "data-textDelta",
                  data: `token-${index} `,
                  transient: true,
                })),
              ]
            : Array.from({ length: 20 }, () => ({
                type: `data-${artifactKind}Delta`,
                data: snapshotContent[artifactKind],
                transient: true,
              }));
        const events: Record<string, unknown>[] = [
          { type: "start", messageId: "assistant-artifact" },
          { type: "start-step" },
          { type: "data-id", data: documentId, transient: true },
          {
            type: "data-title",
            data: "Reliable Artifact",
            transient: true,
          },
          { type: "data-kind", data: artifactKind, transient: true },
          { type: "data-clear", data: null, transient: true },
          ...streamParts,
        ];

        if (shouldFail) {
          events.push({ type: "error", errorText: "Mock connection lost" });
        } else {
          events.push(
            { type: "data-finish", data: null, transient: true },
            { type: "finish-step" },
            { type: "finish", finishReason: "stop" }
          );
        }

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            let index = 0;
            const writeNext = () => {
              const event = events[index];
              if (!event) {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
                return;
              }
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
              );
              index += 1;
              window.setTimeout(writeNext, delay);
            };
            writeNext();
          },
        });

        return Promise.resolve(
          new Response(stream, {
            headers: {
              "content-type": "text/event-stream",
              "x-vercel-ai-ui-message-stream": "v1",
            },
          })
        );
      };
    },
    {
      shouldFail: fail,
      delay: intervalMs,
      documentId: DOCUMENT_ID,
      artifactKind: kind,
    }
  );
}

async function mockPersistedDocument(
  page: Page,
  saveStatus = 200,
  {
    kind = "text",
    content = "# Persisted title\n\n正文 remains visible.",
  }: {
    kind?: "text" | "code" | "sheet" | "image";
    content?: string;
  } = {}
) {
  await page.route(`**/api/document?id=${DOCUMENT_ID}`, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: saveStatus,
        contentType: "application/json",
        body:
          saveStatus >= 200 && saveStatus < 300
            ? JSON.stringify([
                {
                  id: DOCUMENT_ID,
                  title: "Reliable Artifact",
                  kind,
                  content: "",
                  userId: "test-user",
                  createdAt: new Date().toISOString(),
                },
              ])
            : JSON.stringify({ error: "save failed" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: DOCUMENT_ID,
          title: "Reliable Artifact",
          kind,
          content,
          userId: "test-user",
          createdAt: new Date().toISOString(),
        },
      ]),
    });
  });
}

async function startGeneration(page: Page) {
  await page.goto("/");
  const input = page.getByTestId("multimodal-input").first();
  await input.fill("Create a long artifact");
  await page.getByTestId("send-button").first().click();
}

test.describe("Artifact reliability", () => {
  test("shows batched streaming content and respects a responsive user close", async ({
    page,
  }) => {
    await installArtifactStream(page, { intervalMs: 100 });
    await mockPersistedDocument(page);
    await startGeneration(page);

    await expect(page.getByTestId("artifact-streaming-preview")).toContainText(
      "Streaming artifact"
    );
    await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>(
        '[data-testid="artifact-close-button"]'
      );
      button?.addEventListener(
        "click",
        () => {
          const startedAt = performance.now();
          const observer = new MutationObserver(() => {
            if (!document.querySelector('[data-testid="artifact"]')) {
              (
                window as Window & { __artifactCloseLatency?: number }
              ).__artifactCloseLatency = performance.now() - startedAt;
              observer.disconnect();
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        },
        { once: true }
      );
    });
    await page.getByTestId("artifact-close-button").click();
    await expect(page.getByTestId("artifact")).toBeHidden();
    await page.waitForFunction(
      () =>
        typeof (window as Window & { __artifactCloseLatency?: number })
          .__artifactCloseLatency === "number"
    );
    const closeLatency = await page.evaluate(
      () =>
        (window as Window & { __artifactCloseLatency?: number })
          .__artifactCloseLatency ?? Number.POSITIVE_INFINITY
    );
    expect(closeLatency).toBeLessThan(200);

    await page.waitForTimeout(500);
    await expect(page.getByTestId("artifact")).toBeHidden();
  });

  test("loads the editor after finish and reports an empty-document save failure", async ({
    page,
  }) => {
    await installArtifactStream(page);
    await mockPersistedDocument(page, 500);
    await startGeneration(page);

    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText("Persisted title");

    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await expect(page.getByText("Save failed", { exact: true })).toBeVisible();
  });

  test("preserves partial content and exits loading when the stream fails", async ({
    page,
  }) => {
    await installArtifactStream(page, { fail: true, intervalMs: 1 });
    await mockPersistedDocument(page);
    await startGeneration(page);

    await expect(
      page
        .getByTestId("artifact")
        .getByText("Mock connection lost", { exact: true })
    ).toBeVisible();
    await expect(page.getByTestId("artifact-streaming-preview")).toContainText(
      "Streaming artifact"
    );
    await expect(page.getByText("Generating…", { exact: true })).toHaveCount(0);
  });

  for (const scenario of [
    {
      kind: "code" as const,
      content: 'print("ready")',
      completedSelector: ".cm-editor",
      expected: "ready",
    },
    {
      kind: "sheet" as const,
      content: "name,value\nready,2",
      completedSelector: ".rdg",
      expected: "ready",
    },
    {
      kind: "image" as const,
      content:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
      completedSelector: 'img[alt="Reliable Artifact"]',
      expected: null,
    },
  ]) {
    test(`${scenario.kind} keeps a lightweight stream preview and loads its completed view`, async ({
      page,
    }) => {
      await installArtifactStream(page, {
        intervalMs: 250,
        kind: scenario.kind,
      });
      await mockPersistedDocument(page, 200, {
        kind: scenario.kind,
        content: scenario.content,
      });
      await startGeneration(page);

      await expect(
        page.getByTestId("artifact-streaming-preview")
      ).toBeVisible();
      const completed = page.locator(scenario.completedSelector);
      await expect(completed).toBeVisible();
      if (scenario.expected) {
        await expect(completed).toContainText(scenario.expected);
      }
    });
  }
});

test.describe("Artifact mobile regression", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the streaming preview and close control usable", async ({
    page,
  }) => {
    await installArtifactStream(page, { intervalMs: 50 });
    await mockPersistedDocument(page);
    await startGeneration(page);

    await expect(page.getByTestId("artifact-streaming-preview")).toBeVisible();
    await expect(page.getByTestId("artifact-close-button")).toBeVisible();
  });
});
