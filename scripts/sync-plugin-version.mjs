// Keeps .claude-plugin/plugin.json's version in step with package.json's.
//
// Wired to the `version` npm lifecycle script, which runs after `npm version`
// has bumped package.json but *before* it commits — so staging the plugin
// manifest here lands it in the same chore(release) commit, and the two
// versions cannot drift regardless of who cuts the release.
//
// This is load-bearing rather than hygiene: plugin.json's `version` is the
// cache key Claude Code uses to decide whether a plugin update is available.
// If it stops changing, `/plugin update` silently skips the plugin and users
// stay on an old build no matter what else moves.
import { readFileSync, writeFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const path = '.claude-plugin/plugin.json'
const raw = readFileSync(path, 'utf8')
const plugin = JSON.parse(raw)

if (plugin.version === pkg.version) {
  console.log(`plugin.json already at ${pkg.version}`)
  process.exit(0)
}

const before = plugin.version
plugin.version = pkg.version

// Preserve the file's existing shape: 2-space indent, trailing newline.
const trailing = raw.endsWith('\n') ? '\n' : ''
writeFileSync(path, JSON.stringify(plugin, null, 2) + trailing)

console.log(`plugin.json ${before} -> ${pkg.version}`)
