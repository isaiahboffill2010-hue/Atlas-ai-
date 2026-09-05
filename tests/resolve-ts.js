/**
 * Lets `node --test` load the app's TypeScript modules directly.
 *
 * Node strips types on its own, but its ESM resolver requires file extensions,
 * while the app (like the rest of the project, and like Next.js expects) imports
 * './foo' without one. This hook fills that gap for the test run only — no
 * source file has to be written differently to be testable.
 */

const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')
const { fileURLToPath, pathToFileURL } = require('node:url')

const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx']

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && path.extname(specifier) === '') {
      const parent = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd()
      const base = path.resolve(path.dirname(parent), specifier)

      for (const suffix of CANDIDATE_SUFFIXES) {
        const candidate = base + suffix
        if (fs.existsSync(candidate)) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true }
        }
      }
    }

    return nextResolve(specifier, context)
  },
})
