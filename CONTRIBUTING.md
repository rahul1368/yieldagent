# Contributing

Thanks for your interest in yieldagent. It's meant to stay small and readable,
so the bar for new features is "does this belong in a loop you can read in a few
minutes?" Bug fixes, tests, docs, and adapters are always welcome.

## Getting started

```bash
git clone https://github.com/rahul1368/yieldagent
cd yieldagent
npm install
npm test          # run the test suite
npm run typecheck # type-check without emitting
npm run build     # build to dist/
```

## Guidelines

- **No runtime dependencies in the core.** Optional integrations (like Zod) go
  behind their own entry point with the dependency as an optional peer.
- **No `any`.** Use `unknown` for data whose shape the model controls, and
  precise types everywhere else.
- **Tests come with changes.** The suite uses a scripted model, no network, no
  API key, so please cover new behavior the same way.
- **Keep it small.** If a feature needs a lot of surface area, it may belong in a
  separate package rather than the core.

## Pull requests

- Keep PRs focused and describe the motivation.
- Make sure `npm test`, `npm run typecheck`, and `npm run build` all pass.
- Update the README and `CHANGELOG.md` when behavior changes.
