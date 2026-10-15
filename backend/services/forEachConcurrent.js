async function forEachConcurrent(items, concurrency, worker) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("concurrency must be a positive integer");
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
}
module.exports = { forEachConcurrent };
