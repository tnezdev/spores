import type { Ctx } from "./context.js"

/**
 * Shared CLI output helper. Library code must NOT call console.log directly —
 * CLI commands render through this helper so JSON mode is honored uniformly.
 */
export function output<T>(
  ctx: Ctx,
  data: T,
  humanFn: (data: T) => string,
): void {
  if (ctx.json) {
    console.log(JSON.stringify(data, null, 2))
  } else {
    console.log(humanFn(data))
  }
}
