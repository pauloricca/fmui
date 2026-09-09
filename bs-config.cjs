module.exports = {
  server: 'app',
  files: 'app/**/*',
  // Docker Desktop bind mounts do not reliably forward filesystem events.
  watchOptions: { usePolling: true, interval: 300 },
  watchEvents: ['add', 'change', 'unlink'],
  listen: '0.0.0.0',
  port: 5173,
  open: false,
  ui: false,
  online: false,
  notify: false,
  ghostMode: false,
  middleware: [(_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  }],
};
