// Registers the jest-dom matchers (toBeInTheDocument etc.) in vitest,
// and auto-cleans every render between tests.
//
// Why manual cleanup here: vitest `globals` are OFF in our config, so
// @testing-library/react does not auto-clean by itself. And why NAMESPACE
// import for cleanup: named imports from CJS-rooted packages are fragile
// under ESM transform (the same trap as finding #18 in the authorization
// service — `import { cleanup }` resolved to undefined in the vitest
// transform); a namespace import always works.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import * as RTL from '@testing-library/react'

afterEach(() => RTL.cleanup())
