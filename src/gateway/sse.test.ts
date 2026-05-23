import { describe, expect, test } from "bun:test"
import { parseAppEvent, parseSse } from "./sse"

describe("SSE parser", () => {
  test("parses event id, event name, and JSON data", async () => {
    const response = new Response(
      'id: boot:1\nevent: response\ndata: {"type":"response","content":"hello","thread_id":"t1"}\n\n',
    )

    const frames = []
    for await (const frame of parseSse(response)) {
      frames.push(frame)
    }

    expect(frames).toEqual([
      {
        id: "boot:1",
        event: "response",
        data: '{"type":"response","content":"hello","thread_id":"t1"}',
      },
    ])
    expect(parseAppEvent(frames[0])).toEqual({
      type: "response",
      content: "hello",
      thread_id: "t1",
    })
  })

  test("joins multi-line data payloads", async () => {
    const response = new Response("event: status\ndata: first\ndata: second\n\n")

    const frames = []
    for await (const frame of parseSse(response)) {
      frames.push(frame)
    }

    expect(frames[0]?.data).toBe("first\nsecond")
  })
})

