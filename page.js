// Runs in Chrome's isolated world. Only reads and operates the visible page.
globalThis.inspectTaobao = async (step, scroll = false) => {
  const visible = element => Boolean(element?.getClientRects().length) &&
    getComputedStyle(element).visibility === 'visible';
  const label = element => element?.innerText?.trim() || '';
  const elements = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
  const exact = (root, selector, pattern) => elements(root, selector)
    .filter(element => pattern.test(label(element)));
  const textNodes = (root, pattern) => exact(root, 'div,span,h1,h2,h3,h4,button,a,p', pattern)
    .filter(element => ![...element.children].some(child => visible(child) && pattern.test(label(child))));
  const click = element => (element.closest('button,a,[role=button]') || element).click();
  if (/请先登录|滑动验证|访问受限|请完成安全验证|访问过于频繁/.test(document.body?.innerText.slice(0, 1500))) {
    return {error:'请在淘宝页面完成登录或验证，再点击继续。'};
  }
  if (step === 'search') {
    if (location.hostname !== 's.taobao.com') return {error:'请打开淘宝搜索结果页。'};
    const products = new Map();
    for (const anchor of elements(document, 'a[href]')) {
      const href = new URL(anchor.href);
      const id = href.searchParams.get('id');
      if (!['item.taobao.com','detail.tmall.com'].includes(href.hostname) ||
          href.pathname !== '/item.htm' || !/^\d+$/.test(id || '')) continue;
      if (!products.has(id)) products.set(id, {id, url:href.href});
    }
    const sorted = textNodes(document, /^销量(?:排序)?$/).some(element => {
      const control = element.closest('button,a,[role=tab]') || element;
      return control.getAttribute('aria-selected') === 'true' ||
        control.getAttribute('aria-pressed') === 'true' ||
        /(?:^|[\s_-])(?:active|selected|current)(?:$|[\s_-])/i.test(String(control.className));
    });
    const next = elements(document, 'button,a,[role=button]').find(element =>
      /^下一页(?:\s*[>›»])?$/.test(label(element)) || /下一页/.test(element.getAttribute('aria-label') || ''));
    const pagination = next || textNodes(document, /^共\s*\d+\s*页$/)[0];
    if (scroll && !pagination) {
      window.scrollBy(0, Math.max(300, innerHeight * .8));
    }
    return {products:[...products.values()], sorted, next:Boolean(next), last:Boolean(next &&
      (next.disabled || next.getAttribute('aria-disabled') === 'true' ||
      /disabled/i.test(String(next.className)))), bottom:scrollY + innerHeight >= document.documentElement.scrollHeight - 4,
      ready:document.readyState === 'complete'};
  }
  if (step === 'next') {
    const next = elements(document, 'button,a,[role=button]').find(element =>
      /^下一页(?:\s*[>›»])?$/.test(label(element)) || /下一页/.test(element.getAttribute('aria-label') || ''));
    if (!next || next.disabled || next.getAttribute('aria-disabled') === 'true' ||
        /disabled/i.test(String(next.className))) return {error:'无法确认下一页按钮，请检查搜索页。'};
    click(next);
    return {clicked:true};
  }
  const heading = /^问大家(?:\s*[·・(（]?\s*\d+\s*[)）]?)?$/;
  const questionHeadings = textNodes(document, heading);
  // An open drawer has its own search box or a dialog container around the Q&A heading.
  let drawer;
  for (const title of questionHeadings) {
    for (let parent = title.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (parent.matches('[role=dialog],dialog') ||
          (parent.querySelector('input[placeholder*="搜索"]') && textNodes(parent, /^问$/).length)) {
        drawer = parent;
        break;
      }
    }
    if (drawer) break;
  }
  if (!drawer) {
    const open = textNodes(document, /^查看全部问答$/)[0];
    if (open && step === 'product') {
      click(open);
      return {opening:true};
    }
    if (step === 'product') {
      const params = elements(document, '.paramsInfoArea').find(element =>
        element.getBoundingClientRect().top < innerHeight);
      if (params && document.readyState === 'complete' && !questionHeadings.length) {
        // On the verified detail layout, Q&A appears before the parameter section.
        return {missing:true,bottom:true,complete:true};
      }
      const before = scrollY;
      window.scrollBy(0, Math.max(300, innerHeight * .8));
      return {scrollMoved:scrollY > before, missing:!questionHeadings.length,
        bottom:scrollY + innerHeight >= document.documentElement.scrollHeight - 4,
        complete:document.readyState === 'complete' &&
          Boolean(textNodes(document, /^(用户评价|商品评价|参数信息|图文详情)$/).length)};
    }
    return {waiting:true};
  }

  const rows = [];
  for (const marker of textNodes(drawer, /^问$/)) {
    let sibling = marker.nextElementSibling;
    let parent = marker.parentElement;
    while (!sibling && parent && parent !== drawer && label(parent) === '问') {
      sibling = parent.nextElementSibling;
      parent = parent.parentElement;
    }
    const content = label(sibling);
    if (!content || /^(查看全部回答|更多回答|商家|已购|问)$/.test(content)) continue;
    const row = marker.closest('[data-question-id],[data-questionid]');
    rows.push({text:content, id:row?.getAttribute('data-question-id') || row?.getAttribute('data-questionid') || ''});
  }
  const title = textNodes(drawer, heading)[0];
  const totalText = label(title).match(/\d+/)?.[0];
  const scrollers = [drawer, ...elements(drawer, 'div,section,ul')].filter(element =>
    /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight &&
    textNodes(element, /^问$/).length);
  const pane = scrollers.at(-1);
  const bottom = !pane || pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 4;
  if (scroll && pane && (!totalText || rows.length < Number(totalText)) && !bottom) {
    pane.scrollBy(0, Math.max(80, pane.clientHeight * .65));
  }
  const loading = document.readyState !== 'complete' ||
    Boolean(elements(drawer, '[aria-busy=true],[class*="Loading--"],[class*="loading--"]').length) ||
    Boolean(textNodes(drawer, /^(加载中[.…。]*|正在加载[.…。]*)$/).length);
  // Taobao renders the same title in its product panel and sticky header.
  // The inner span excludes adjacent promotional badges and contains the full text.
  const normalize = text => text?.replace(/\s+/g, ' ').trim() || '';
  const titleNodes = elements(document, 'div[class^="ItemTitle--"] div[class^="MainTitle--"] > span[class^="mainTitle--"]');
  const titles = new Set(titleNodes.filter(node =>
    !drawer.contains(node) && !node.closest('aside,dialog,[role=dialog],[class*="tabDetailItem--"]'))
    .map(node => {
      const visibleText = normalize(label(node));
      const fullText = normalize(node.getAttribute('title'));
      if (!visibleText) return '';
      const clipped = visibleText.replace(/(?:…|\.\.\.)$/, '').trimEnd();
      if (fullText && (visibleText === fullText || (clipped && clipped !== visibleText && fullText.startsWith(clipped)))) {
        return fullText;
      }
      return clipped === visibleText ? visibleText : '';
    }).filter(Boolean));
  const productTitle = titles.size === 1 ? [...titles][0] : '';
  return {rows, productTitle, total:totalText ? Number(totalText) : null, bottom, loading,
    end:Boolean(textNodes(drawer, /^(没有更多了|暂无更多|已显示全部)$/).length)};
};
