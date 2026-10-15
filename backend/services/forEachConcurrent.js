async function forEachConcurrent(items, concurrency, worker) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("concurrency must be a positive integer");
  if (typeof worker !== "function") throw new TypeError("worker must be a function");

  let cursor = 0;
  let hasError = false;
  let firstError;

  async function runWorker() {
    while (cursor < items.length && !hasError) {
      const index = cursor++;
      try {
        await worker(items[index], index);
      } catch (error) {
        // Stop scheduling new work on the first failure, but let already-running
        // workers settle before rejecting the overall operation. Track the
        // failure separately because JavaScript permits throwing null/undefined.
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );

  if (hasError) throw firstError;
}

module.exports = { forEachConcurrent };
