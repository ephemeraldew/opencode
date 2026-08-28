import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./read-session.txt"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"

export const Parameters = Schema.Struct({
  sessionID: Schema.optional(Schema.String).annotate({
    description:
      "The session to read. Defaults to the origin/main session this session was created from, or the current session.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of recent messages to include (default 50)",
  }),
})

const PART_LIMIT = 2000
const DEFAULT_LIMIT = 50

function truncate(text: string) {
  if (text.length <= PART_LIMIT) return text
  return `${text.slice(0, PART_LIMIT)}\n[... truncated ${text.length - PART_LIMIT} chars]`
}

export const ReadSessionTool = Tool.define(
  "read_session",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const agent = yield* agents.get(ctx.agent)
          if (!agent) return { title: "read_session", output: `Agent not found: ${ctx.agent}`, metadata: {} }
          const enabled = agent.permission.some(
            (rule) => rule.permission === "read_session" && rule.action === "allow",
          )
          if (!enabled) {
            return {
              title: "read_session",
              output: [
                "The read_session tool is not enabled for this agent.",
                "Enable it by adding the following to the agent definition:",
                "tools:",
                "  read_session: true",
              ].join("\n"),
              metadata: {},
            }
          }

          const current = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
          const target = params.sessionID ?? current.metadata?.root ?? ctx.sessionID
          const targetSession = yield* sessions
            .get(target)
            .pipe(Effect.catchCause(() => Effect.succeed(undefined)))
          if (!targetSession) {
            return { title: "read_session", output: `Session not found: ${target}`, metadata: {} }
          }

          const msgs = yield* sessions
            .messages({
              sessionID: targetSession.id,
              ...(params.limit ? { limit: params.limit } : {}),
            })
            .pipe(Effect.orDie)
          const lines: string[] = []
          for (const msg of [...msgs].sort((a, b) => a.info.time.created - b.info.time.created)) {
            const role = msg.info.role
            const text = msg.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text.trim())
              .filter(Boolean)
              .join("\n")
            if (!text) continue
            const who =
              role === "assistant"
                ? `assistant (agent: ${"agent" in msg.info ? msg.info.agent : "unknown"})`
                : "user"
            lines.push(`[${who}]: ${truncate(text)}`)
          }
          if (lines.length === 0) {
            return {
              title: "read_session",
              output: `No readable messages in session ${targetSession.id}.`,
              metadata: {},
            }
          }
          return {
            title: targetSession.title,
            output: [
              `<session_history session_id="${targetSession.id}" title="${targetSession.title}">`,
              ...lines,
              "</session_history>",
            ].join("\n"),
            metadata: {},
          }
        }),
    }
  }),
)
