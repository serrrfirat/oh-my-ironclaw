import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { readConfig } from "./config"
import { App } from "./ui/App"

const renderer = await createCliRenderer({ useMouse: true })
const config = readConfig()

createRoot(renderer).render(<App config={config} />)
