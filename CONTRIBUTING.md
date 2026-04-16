# Contributing

Thanks for your interest!

## Development

```bash
pnpm install
pnpm run typecheck
pnpm run lint
pnpm test
```

## Workflow

- All changes start with a failing test. See [the spec's testing section](docs/superpowers/specs/2026-04-16-whatsapp-cli-design.md#10-testing-strategy).
- Keep commits small and conventional (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`).
- Open a PR against `main`. CI must pass.

## Reporting issues

Open a GitHub issue with:

- The command you ran.
- The `--json` output (or stderr).
- Your OS + `whatsapp-cli --version`.

Do not include message bodies or phone numbers unless you've redacted them.
