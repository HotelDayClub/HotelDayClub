const zlib = require('zlib');

const TEXT = /text|json|javascript|xml|svg|manifest/;

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

  function flushPending(target) {
    const buf = pending.length ? Buffer.concat(pending) : null;
    pending = [];
    return buf && target ? target(buf) : buf;
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

  res.write = function (chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (chunk == null) { if (cb) cb(); return true; }
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');
    if (mode === 'zip') return zipper.write(chunk, cb);
    if (mode === 'plain') return write(chunk, cb);
    pending.push(chunk);
    const size = pending.reduce((n, c) => n + c.length, 0);
    if (size < 1024) { if (cb) cb(); return true; }
    const zipped = start(size);
    const buf = flushPending();
    if (!zipped) return write(buf, cb);
    return zipper.write(buf, cb);
  };

  res.end = function (chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; encoding = undefined; }
    else if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (chunk != null && !Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');
    if (mode === 'zip') {
      zipper.end(chunk);
      if (cb) zipper.once('end', cb);
      return res;
    }
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
