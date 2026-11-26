# Readyline

Licensing exam prep with a learner model you can audit. Version 1 targets the New Jersey Life Producer exam and gives insurance agencies a readiness view of every recruit.

The system is built first and the interface last. See [ARCHITECTURE.md](ARCHITECTURE.md) for the design and [reports/simulation.md](reports/simulation.md) for the latest verification run.

## What is here

| Path | What it is |
|---|---|
| `src/engine` | Pure TypeScript learner engine: ability model, FSRS memory, readiness simulation, scheduler, item calibration |
| `src/sim` | Simulated learners with known true ability, used to verify the engine |
| `supabase/migrations` | Database schema: content provenance, versioned items, append-only event log |
| `content/exams/nj-life` | Exam blueprint with sources |
| `tests` | Unit tests |

## Run it

```bash
npm install
npm test        # unit tests
npm run sim     # full simulation, writes reports/simulation.md
```

## Latest verification (simulated)

- Pass prediction: Brier 0.104 vs 0.232 baseline, calibration error 0.033
- Ability recovery: r = 0.88 after 25 to 75 answers, 0.97 after 150+
- Miskeyed items: 11 of 11 caught once an item has 30+ responses
