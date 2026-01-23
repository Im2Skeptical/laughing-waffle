# Effects refactor smoke test plan

- Build or start the app and confirm module imports resolve without warnings.
- Run a short deterministic scenario twice with identical inputs; compare serialized snapshots at checkpoints.
- Use timeline replay (rebuildStateAtSecond) and forward sim for the same inputs; confirm matching snapshots.
- Exercise inventory ops (move/stack/split) and verify inventory version bumps and outcomes match prior behavior.
- Run env step integration to confirm stepEnvSecond still calls runEffect without errors.
- Run cmdAdvanceSeason and cmdTickSimulation and confirm item seasonal/second processing is unchanged.
- Verify projection remains pure by checking no mutations on projection inputs.
