const { esc } = require('./util');

class LinkStyles {
  static sectionAction(href, label) {
    const text = String(label || '').trim();
    const url = String(href || '').trim();
    if (!url || !text) return '';
    return `<a class="sec-action" href="${esc(url)}">${esc(text)}<span class="sa-arr" aria-hidden="true">→</span></a>`;
  }

  static textLink(href, label) {
    const text = String(label || '').trim();
    const url = String(href || '').trim();
    if (!url || !text) return '';
    return `<a class="text-link" href="${esc(url)}">${esc(text)}</a>`;
  }
}

module.exports = { LinkStyles };