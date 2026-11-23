# Linear and bracketed nonlinear solves

Use `KIT.world.solvers` inside a simulation kernel or standalone
JavaScript. Use `ink-studio sim solve <plan.json>` for authored systems.
The solvers use native JavaScript and typed arrays. They preserve the
input matrix and right-hand side.

## Solve a linear system

| Method | Matrix representation and algorithm |
| --- | --- |
| `dense(matrix, rhs, settings)` | Up to 512 rows as an array of square rows. Row-scaled Gaussian elimination with partial pivoting. |
| `tridiagonal(matrix, rhs, settings)` | Up to 65,536 rows. Supply `{lower, diagonal, upper}` of lengths `n-1`, `n`, and `n-1`. Adjacent row pivots preserve the extra superdiagonal when necessary. |
| `sparse(matrix, rhs, settings)` | Up to 65,536 rows and 1,000,000 stored entries. Supply CSR `{rowPointers, columns, values}` with zero-based, unique, ascending columns within each row. Row-scaled restarted GMRES supports nonsymmetric systems. |

```js
const {KIT} = require('@shapeshift-labs/ink-studio').load();
const result = KIT.world.solvers.tridiagonal(
  {lower:[-1,-1], diagonal:[2,2,2], upper:[-1,-1]},
  [1,0,0]
);
console.log(Array.from(result.solution));
console.log(result.residual);
```

Linear results contain `status`, `converged`, `solution`, `residual`,
and `work`. The solution uses a `Float64Array` in the library and a
regular array in a JSON report. A direct solve without a complete
solution returns `null`. Sparse solves retain the iterate with the
lowest measured residual, beginning with `initial` or zero. An
extremely small budget can leave a candidate without a measured residual.

The reported residual uses the original coefficients. Its `absolute`
value is the infinity norm of `rhs - matrix × solution`. `relative`
divides by the infinity norm of `rhs` when that ratio is defined and
finite. The test is
`absolute <= max(absoluteTolerance, relativeTolerance * norm(rhs))`.
The tolerances default to 0 and 1e-10 respectively. A small residual
measures agreement with the equations. Poor conditioning can still
amplify solution error.

- `maxWork` defaults to 40,000,000, with a maximum of 250,000,000.
  Work units charge dimension-dependent costs for factorization,
  matrix products, vector operations, and residual checks. Shape
  validation is separate and subject to the matrix size bounds.
- Direct solvers report elimination steps and row swaps. Pivots at or
  below `pivotTolerance` (default 1e-14) in the scaled matrix yield
  `singular`. A complete solution that misses the requested residual
  is returned with status `residual`.
- Sparse controls include `restart` (default 24, range 1–64),
  `maxIterations` (default the smaller of 1,000 and four times the
  row count), an optional `initial` guess, and `history:true`.
  A zero iteration limit checks the initial residual only. Work evidence
  includes iterations and matrix products. History records true residuals
  at initial and completed restart or termination checks.
- Budget exits report `work-limit` or `iteration-limit`. A sparse
  iteration can also stop with `breakdown` if the search space closes
  before convergence, or `stagnated` if a restart leaves the solution
  unchanged. Out-of-range numerical results can report `non-finite`.

## Locate a scalar root

Call `root(fn, [lower, upper], settings)` with a continuous scalar
function and a sign-changing bracket. Exact zero endpoints are accepted.
The solver tries a secant point in the central part of the bracket and
bisects when the proposed point is too close to either end. The retained
interval always brackets a sign change during a successful search.

The result includes the reported point, its signed `value`, absolute
`residual`, final `bracket`, `bracketValues`, and evaluation count.
`reason` distinguishes convergence from a small function value and from
a narrow interval. `fTolerance` defaults to 0 and `xTolerance` to 1e-10.
`relativeXTolerance` defaults to four times machine epsilon. Set
`maxEvaluations` to limit work, including endpoint evaluations
(default 128, maximum 4,096). Optional `history:true` records each finite
evaluation. A missing sign change reports `unbracketed`, and a
non-finite callback value reports `non-finite`.

## CLI and demo

A version 1 plan has format `ink-studio/solve-plan`, a `method`, and
optional `settings`. Linear plans have `matrix` and `rhs`. Root plans
have `bracket` and an `equation`. Use ascending polynomial
`coefficients` or a trusted JavaScript `module` referenced relative to
the plan. An equation module exports `(kit, config) => x => value`.

```json
{
  "format": "ink-studio/solve-plan",
  "version": 1,
  "method": "root",
  "bracket": [0, 3],
  "equation": {"coefficients": [-54, 2.4, 17.5]},
  "settings": {"fTolerance": 1e-9, "history": true}
}
```

`sim solve` emits an `ink-studio/solve-report` even when a validated
solve fails to converge. Use `--require-convergence` to make that status
fail the command after writing the report.

```sh
node examples/simulation-numerical-solvers/demo.cjs /tmp/ink-solvers
node cli/ink-studio.js sim solve /tmp/ink-solvers/sparse.plan.json --require-convergence
node cli/ink-studio.js sim solve /tmp/ink-solvers/root.plan.json --require-convergence
```

The demo solves coupled controls, steady heat through a layered rod,
pressure through a baffled channel, and a nonlinear valve flow. The
channel check compares the matrix residual with the
[finite-volume diffusion operator](grid-operators.md). It also exercises
an intentionally small work budget and writes the outcome alongside
the converged reports.
