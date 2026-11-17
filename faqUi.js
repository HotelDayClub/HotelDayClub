const { esc } = require('./util');

/** Styled disclosure row with circular plus icon (phase 2 inner pages). */
function faqPlusDetail(question, answerHtml) {
  return `<details><summary><span>${esc(question)}</span><i class="faq-plus" aria-hidden="true"></i></summary><p>${answerHtml}</p></details>`;
}

module.exports = { faqPlusDetail };