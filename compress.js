const zlib = require('zlib');

const TEXT = /text|json|javascript|xml|svg|manifest/;
const MAX_BUFFER = 1024 * 1024;

function vary(res) {
  const prev = res.getHeader('Vary');
  const parts = String(prev || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.includes('Accept-Encoding')) parts.push('Accept-Encoding');
  res.setHeader('Vary', parts.join(', '));
}

function compressible(res, size) {
  if (res.headersSent || res.getHeader('Content-Encoding')) return false;
  const type = String(res.getHeader('Content-Type') || '');
  if (!TEXT.test(type)) return false;
  if (size != null && size < 1024) return false;
  return true;
}

function compress(req, res, next) {
  if (req.method === 'HEAD' || req.headers.range) return next();
  const ae = String(req.headers['accept-encoding'] || '');
  const br = /\bbr\b/.test(ae);
  const gzip = /\bgzip\b/.test(ae);
  if (!br && !gzip) return next();

  const write = res.write.bind(res);
  const end = res.end.bind(res);
  let zipper = null;
  let pending = [];
  let mode = null;

  function flushPending() {
    const buf = pending.length ? Buffer.concat(pending) : null;
    pending = [];
    return buf;
  }

  function pendingSize() {
    return pending.reduce((n, c) => n + c.length, 0);
  }

  function start(size) {
    mode = 'plain';
    if (!compressible(res, size)) return false;
    mode = 'zip';
    zipper = br
      ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })
      : zlib.createGzip({ level: 6 });
    vary(res);
    res.setHeader('Content-Encoding', br ? 'br' : 'gzip');
    res.removeHeader('Content-Length');
    zipper.on('data', chunk => {
      if (!write(chunk)) zipper.pause();
    });
    res.on('drain', () => { if (zipper) zipper.resume(); });
    zipper.on('end', () => end());
    zipper.on('error', () => { if (!res.writableEnded) end(); });
    return true;
  }

  // Hold the body until end, then compress it in one shot. Static files are
  // piped, and zlib.write() returns false once a chunk passes the writable
  // high water mark (16KB on Node 20, which Render runs) without producing
  // output until flush. The file stream then waits for a drain that never
  // comes, so the response hangs before any body bytes. Compressing on end
  // flushes the encoder. Past MAX_BUFFER, send the rest uncompressed.
  res.write = function (chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (chunk == null) { if (cb) cb(); return true; }
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');
    if (mode === 'plain') return write(chunk, cb);
    const type = String(res.getHeader('Content-Type') || '');
    if (type && !TEXT.test(type)) {
      mode = 'plain';
      pending.push(chunk);
      return write(flushPending(), cb);
    }
    pending.push(chunk);
    if (pendingSize() <= MAX_BUFFER) { if (cb) cb(); return true; }
    mode = 'plain';
    return write(flushPending(), cb);
  };

  res.end = function (chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; encoding = undefined; }
    else if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (chunk != null && !Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');
    if (mode === 'plain') return end(chunk, cb);
    if (chunk) pending.push(chunk);
    const buf = flushPending();
    const size = buf ? buf.length : 0;
    if (!start(size)) return end(buf && buf.length ? buf : undefined, cb);
    zipper.end(buf);
    if (cb) zipper.once('end', cb);
    return res;
  };

  next();
}

module.exports = compress;
