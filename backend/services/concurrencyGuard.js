function createConcurrencyGuard({ activeByKey = new Map() } = {}) {
  return function concurrencyGuard(limit = 2) {
    return (req, res, next) => {
      const route = req.path || req.originalUrl?.split("?")[0] || "unknown";
      const key = `${req.ip || "unknown"}:${route}`;
      const active = activeByKey.get(key) || 0;
      if (active >= limit) return res.status(429).json({ success: false, error: "Çok fazla eşzamanlı istek." });
      activeByKey.set(key, active + 1);
      res.on("finish", () => {
        const remaining = (activeByKey.get(key) || 1) - 1;
        if (remaining > 0) activeByKey.set(key, remaining);
        else activeByKey.delete(key);
      });
      next();
    };
  };
}

module.exports = { createConcurrencyGuard };
