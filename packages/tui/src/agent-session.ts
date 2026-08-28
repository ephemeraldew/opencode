import type { useSync } from "./context/sync"
import type { useLocal } from "./context/local"
import type { useSDK } from "./context/sdk"
import type { useToast } from "./ui/toast"

type Navigate = (route: { type: "session"; sessionID: string } | { type: "home" }) => void

/**
 * Tab: move to the next primary agent's own conversation.
 * - On home (no session) this just preselects the agent for the next prompt.
 * - Agent conversations are isolated sessions tagged with metadata
 *   `{ isolatedAgent: name, root: mainSessionID }`, so they follow the
 *   lifecycle of the main conversation they were raised from.
 */
export async function switchAgentSession(input: {
  route: { type: string; sessionID?: string }
  navigate: Navigate
  sync: ReturnType<typeof useSync>
  local: ReturnType<typeof useLocal>
  sdk: ReturnType<typeof useSDK>
  toast: ReturnType<typeof useToast>
}) {
  const { route, navigate, sync, local, sdk, toast } = input
  if (route.type !== "session" || !route.sessionID) {
    local.agent.move(1)
    return
  }

  const current = sync.session.get(route.sessionID)
  if (!current) return

  const rootID = typeof current.metadata?.root === "string" ? current.metadata.root : route.sessionID
  const root = sync.session.get(rootID)
  if (!root) {
    toast.show({ message: "Origin session not found", variant: "error" })
    return
  }
  const rootAgentName = root.agent ?? local.agent.current()?.name

  const agents = local.agent.list()
  if (agents.length < 2) {
    toast.show({ message: "No other agent to switch to", variant: "warning" })
    return
  }

  const currentAgentName = current.agent ?? local.agent.current()?.name
  const index = agents.findIndex((a) => a.name === currentAgentName)
  const next = agents[(index + 1 + agents.length) % agents.length]

  if (next.name === rootAgentName) {
    if (rootAgentName) local.agent.set(rootAgentName)
    navigate({ type: "session", sessionID: rootID })
    return
  }

  const isolated = sync.data.session.findLast(
    (s) => s.metadata?.isolatedAgent === next.name && s.metadata?.root === rootID,
  )
  if (isolated) {
    if (isolated.agent) local.agent.set(isolated.agent)
    navigate({ type: "session", sessionID: isolated.id })
    return
  }

  const created = await sdk.client.session.create({
    agent: next.name,
    metadata: { isolatedAgent: next.name, root: rootID },
    title: `${next.name} (sidecar)`,
  })
  const session = created.data
  if (!session) return
  toast.show({ message: `Started a fresh conversation with @${next.name}`, variant: "info" })
  local.agent.set(next.name)
  navigate({ type: "session", sessionID: session.id })
}
