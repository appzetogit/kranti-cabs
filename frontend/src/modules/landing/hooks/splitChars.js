/**
 * Wraps each character of the given elements in a <span class="split-char"> and
 * returns the spans, so they can be staggered individually.
 *
 * GSAP's SplitText is a Club GreenSock plugin, and this is all we need from it.
 *
 * The original text is kept as the element's aria-label and the spans are hidden
 * from assistive tech — otherwise a screen reader announces the headline one
 * letter at a time.
 */
export default function splitChars(elements) {
  const out = [];

  Array.from(elements).forEach((el) => {
    if (el.dataset.split === 'done') {
      out.push(...el.querySelectorAll('.split-char'));
      return;
    }

    const text = el.textContent;
    el.setAttribute('aria-label', text);
    el.textContent = '';

    Array.from(text).forEach((ch) => {
      const span = document.createElement('span');
      span.className = 'split-char';
      span.setAttribute('aria-hidden', 'true');
      // a plain space would collapse inside an inline-block
      span.textContent = ch === ' ' ? ' ' : ch;
      el.appendChild(span);
      out.push(span);
    });

    el.dataset.split = 'done';
  });

  return out;
}
