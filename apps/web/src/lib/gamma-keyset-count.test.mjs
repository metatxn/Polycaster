import assert from "node:assert/strict";
import test from "node:test";
import { countGammaKeysetItems } from "./gamma-keyset-count.ts";

const encoder = new TextEncoder();

function streamFromChunks(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

test("counts keyset items without being confused by nested JSON", async () => {
  const stream = streamFromChunks([
    '{"events":[{"id":"1","title":"brace } in string",',
    '"markets":[{"gameStartTime":"2026-05-08T10:00:00Z"}]},',
    '{"id":"2","tags":[{"slug":"sports"}]}],"next_cursor":"abc\\"def"}',
  ]);

  const result = await countGammaKeysetItems(stream, "events");

  assert.deepEqual(result, { count: 2, nextCursor: 'abc"def' });
});

test("counts split keyset arrays with no next cursor", async () => {
  const stream = streamFromChunks([
    '{"data"',
    ':[{"id":"1"}',
    ',{"id":"2"}',
    ',{"id":"3"}]}',
  ]);

  const result = await countGammaKeysetItems(stream, "data");

  assert.deepEqual(result, { count: 3, nextCursor: undefined });
});
